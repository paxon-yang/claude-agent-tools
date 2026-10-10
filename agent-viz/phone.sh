#!/bin/bash
# 手机桌面卡片：一条命令设置好，手机扫二维码就能连上（不用进 Cloudflare Zero Trust 后台）
# 用法：  bash ~/claude-agent-tools/agent-viz/phone.sh              （网址默认 agent-card.你的域名）
#         bash ~/claude-agent-tools/agent-viz/phone.sh card.你的域名  （自己指定网址）
#         bash ~/claude-agent-tools/agent-viz/phone.sh --qr           （只再显示一次二维码）
#         bash ~/claude-agent-tools/agent-viz/phone.sh --new-key      （换一个配对码，旧手机要重新扫）
#         bash ~/claude-agent-tools/agent-viz/phone.sh --remove       （停用）
# 做了什么：在已有的 agent-board 隧道上加一个只给卡片用的网址。这个网址只回答卡片数据和配对页，
# 而且必须带一串随机配对码；看板本身还在原来的网址、照样要邮箱登录。
#
# Phone home-screen card: one command, then scan the QR code on the phone (no Cloudflare Zero Trust dashboard).
# Usage: bash phone.sh [card.example.com] | --qr | --new-key | --remove
# Adds a card-only hostname to the existing agent-board tunnel. It answers only the card data and the pairing
# page, and only with a random pairing key; the board itself stays on its own address behind its login.

VIZ="$HOME/.claude/viz"
APPCFG="$VIZ/app/config.json"
CF_DIR="$HOME/.cloudflared"
CONF="$CF_DIR/agent-board.yml"
TLABEL="local.agent-board-tunnel"

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

command -v node >/dev/null 2>&1 || fail "$(t '没找到 node' 'node not found')"
[ -f "$APPCFG" ] || fail "$(t '没找到看板（~/.claude/viz/app）。先运行 bash ~/claude-agent-tools/install.sh' "The board isn't installed (~/.claude/viz/app). Run bash ~/claude-agent-tools/install.sh first")"
PORT="$(node -e "try{console.log(require('$APPCFG').port||4321)}catch(e){console.log(4321)}")"

# 读写 config.json 里的 card 设置 / read and write the "card" block of config.json
card_get() { node -e "try{const c=require('$APPCFG').card||{};console.log(c['$1']||'')}catch(e){console.log('')}"; }
card_set() {  # host key board
  node -e "
const fs=require('fs'),f='$APPCFG';const c=JSON.parse(fs.readFileSync(f,'utf8'));
if(process.argv[1]==='-'){delete c.card}else{c.card={host:process.argv[1],key:process.argv[2],board:process.argv[3]||null}}
fs.writeFileSync(f,JSON.stringify(c,null,2)+'\n')" "$@"
}

restart_tunnel() {
  if [ "$(uname -s)" = Darwin ] && launchctl print "gui/$(id -u)/$TLABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$TLABEL" >/dev/null 2>&1 && return 0
  fi
  return 1
}

# 在终端里画二维码（第一次会下载一个很小的 npm 包）/ draw a QR code in the terminal (fetches a tiny npm package once)
show_qr() {
  local link="$1"
  QRDIR="$VIZ/app/qr"
  if [ ! -f "$QRDIR/node_modules/qrcode-terminal/package.json" ]; then
    mkdir -p "$QRDIR" && npm install --prefix "$QRDIR" qrcode-terminal@0.12.0 --no-audit --no-fund --loglevel=error >/dev/null 2>&1
  fi
  echo ""
  if node -e "require('$QRDIR/node_modules/qrcode-terminal').generate(process.argv[1],{small:true})" "$link" 2>/dev/null; then :; else
    warn "$(t '画不出二维码，把下面的链接发到手机上打开也一样' "Couldn't draw the QR code; send the link below to your phone instead")"
  fi
  echo ""
  echo "  $link"
  command -v pbcopy >/dev/null 2>&1 && printf '%s' "$link" | pbcopy && echo "  $(t '（链接也已复制到剪贴板）' '(Link copied to the clipboard as well)')"
}

pair_link() { echo "https://$(card_get host)/pair?k=$(card_get key)"; }

case "$1" in
--qr)
  [ -n "$(card_get host)" ] || fail "$(t '还没设置过。先运行 bash phone.sh' 'Not set up yet. Run bash phone.sh first')"
  echo "$(t '用手机相机扫这个二维码：' 'Scan this with your phone camera:')"
  show_qr "$(pair_link)"
  exit 0 ;;
--remove)
  H="$(card_get host)"
  card_set -
  if [ -f "$CONF" ] && [ -n "$H" ]; then
    node -e "
const fs=require('fs'),f=process.argv[1],h=process.argv[2];
const lines=fs.readFileSync(f,'utf8').split('\n');const out=[];
for(let i=0;i<lines.length;i++){ if(lines[i].trim()==='- hostname: '+h){ i++; continue } out.push(lines[i]) }
fs.writeFileSync(f,out.join('\n'))" "$CONF" "$H"
    restart_tunnel
  fi
  ok "$(t "手机卡片的网址已停用（$H）。Cloudflare 里那条 DNS 记录可以手动删掉" "The phone card address is off ($H). You can delete its DNS record in Cloudflare")"
  exit 0 ;;
esac

echo ""
echo "$(t '=== 手机桌面卡片 ===' '=== Phone home-screen card ===')"

# 1. 看板要是新版、正在运行 / the board must be running and new enough
curl -s "http://127.0.0.1:$PORT/api/widget" | grep -q '"v":1' \
  || fail "$(t '看板没在运行，或者还是旧版本。先运行 bash ~/claude-agent-tools/update.sh' "The board isn't running or is too old. Run bash ~/claude-agent-tools/update.sh first")"
ok "$(t '看板在运行' 'The board is running')"

# 2. 需要已经用 cloudflare.sh 挂到域名上 / needs the Cloudflare tunnel from cloudflare.sh
BOARD="$(node -e "try{console.log(require('$VIZ/remote.json').url||'')}catch(e){console.log('')}")"
[ -f "$CONF" ] && [ -n "$BOARD" ] || fail "$(t '还没把看板挂到 Cloudflare。先运行 bash ~/claude-agent-tools/agent-viz/cloudflare.sh board.你的域名；或者手机装 Tailscale，在 App 里直接填 Tailscale 地址' "The board isn't on Cloudflare yet. Run bash ~/claude-agent-tools/agent-viz/cloudflare.sh board.example.com first, or use Tailscale and enter its address in the app")"
ID="$(awk '/^tunnel:/{print $2; exit}' "$CONF")"
BOARD_HOST="${BOARD#https://}"; BOARD_HOST="${BOARD_HOST%%/*}"
ok "$(t "看板网址 $BOARD_HOST，隧道 $ID" "Board at $BOARD_HOST, tunnel $ID")"

# 3. 卡片网址和配对码 / card hostname and pairing key
NEWKEY=0; ARG="$1"; [ "$ARG" = "--new-key" ] && { NEWKEY=1; ARG=""; }
HOST="${ARG:-$(card_get host)}"
[ -z "$HOST" ] && HOST="agent-card.${BOARD_HOST#*.}"
HOST="$(printf '%s' "$HOST" | tr 'A-Z' 'a-z' | sed 's#^https\{0,1\}://##; s#/.*##')"
[ "$HOST" = "$BOARD_HOST" ] && fail "$(t '卡片网址不能和看板网址一样' "The card address can't be the board's address")"
KEY="$(card_get key)"
if [ -z "$KEY" ] || [ "$NEWKEY" = 1 ]; then
  KEY="$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"
fi
card_set "$HOST" "$KEY" "$BOARD"
ok "$(t "卡片网址 $HOST（只给卡片用，带配对码才能访问）" "Card address $HOST (card data only, pairing key required)")"

# 4. 隧道配置里加上这个网址 / add the hostname to the tunnel config
if ! grep -q "hostname: $HOST\$" "$CONF"; then
  node -e "
const fs=require('fs'),f=process.argv[1],h=process.argv[2],port=process.argv[3];
let s=fs.readFileSync(f,'utf8');
s=s.replace(/^(\s*)- service: http_status:404/m,(m,sp)=>sp+'- hostname: '+h+'\n'+sp+'  service: http://127.0.0.1:'+port+'\n'+m);
fs.writeFileSync(f,s)" "$CONF" "$HOST" "$PORT"
fi
grep -q "hostname: $HOST\$" "$CONF" || fail "$(t "没能改好隧道配置 $CONF" "Couldn't update the tunnel config $CONF")"
if cloudflared tunnel route dns --overwrite-dns "$ID" "$HOST" >/tmp/agent-card-dns.log 2>&1; then
  ok "$(t "$HOST 已指向隧道" "$HOST points to the tunnel")"
else
  warn "$(t "自动绑定 DNS 没成功。在 Cloudflare 后台给 ${HOST#*.} 加一条 CNAME：名称 ${HOST%%.*}，内容 $ID.cfargotunnel.com，橙色云" "Couldn't add DNS automatically. In Cloudflare, add a CNAME for ${HOST#*.}: name ${HOST%%.*}, target $ID.cfargotunnel.com, proxied")"
fi
restart_tunnel && ok "$(t '隧道已重启' 'Tunnel restarted')" || warn "$(t '请手动重启隧道：' 'Restart the tunnel yourself: ')cloudflared tunnel --config $CONF run $ID"

# 5. 检查 / check
echo "  $(t '等 10 秒，检查能不能连上……' 'Waiting 10 seconds, then checking…')"
sleep ${PHONE_WAIT:-10}
CODE=""; for _ in 1 2 3 4 5 6; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "X-Card-Key: $KEY" "https://$HOST/api/widget")"
  [ "$CODE" = 200 ] && break; sleep ${PHONE_WAIT:-5}
done
NOKEY="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/api/widget")"
LOC="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 10 "https://$HOST/api/widget")"
if [ "$CODE" = 200 ] && [ "$NOKEY" = 401 ]; then
  ok "$(t '连上了：带配对码能拿到数据，不带配对码会被拒绝' 'Works: the key gets data, no key is refused')"
elif echo "$LOC" | grep -q cloudflareaccess.com; then
  warn "$(t "这个网址也被 Cloudflare Access 拦住了（你的 Access 应用大概覆盖了整个 *.${HOST#*.}）。换一个不在 Access 范围里的网址：bash phone.sh 别的名字.${HOST#*.}" "This address is behind Cloudflare Access too (your Access app probably covers *.${HOST#*.}). Pick one outside it: bash phone.sh other-name.${HOST#*.}")"
else
  warn "$(t "暂时还连不上（状态 $CODE）。DNS 生效可能要一两分钟；先扫码，App 里点\"保存并测试\"再试一次" "Not reachable yet (status $CODE). DNS can take a minute or two; scan anyway and tap \"Save and test\" in the app later")"
fi

echo ""
echo "$(t '用手机相机扫这个二维码，按页面上的三步做（装 App、连接、加到桌面）：' 'Scan this with your phone camera and follow the three steps on the page (install, connect, add to home screen):')"
show_qr "$(pair_link)"
echo "$(t '  以后要再显示二维码：bash ~/claude-agent-tools/agent-viz/phone.sh --qr' '  To show the QR code again: bash ~/claude-agent-tools/agent-viz/phone.sh --qr')"
echo ""
