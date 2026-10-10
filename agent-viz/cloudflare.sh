#!/bin/bash
# 用 Cloudflare 隧道把看板挂到你自己的域名上，任何设备的浏览器都能打开（配合 Cloudflare Access 邮箱验证码登录）
# 用法：  bash cloudflare.sh board.你的域名
# 移除：  bash cloudflare.sh --remove
# 只新建一条名为 agent-board 的隧道和它自己的配置文件 ~/.cloudflared/agent-board.yml，
# 不会改动你给其他项目配的 cloudflared 设置。
# Put the board on your own domain through a Cloudflare tunnel (protect it with Cloudflare Access email codes).
# Usage:  bash cloudflare.sh board.example.com      Remove:  bash cloudflare.sh --remove
# Creates only a tunnel named agent-board with its own config (~/.cloudflared/agent-board.yml); other cloudflared setups are untouched.

HOST="$1"
NAME="agent-board"
CF_DIR="$HOME/.cloudflared"
CONF="$CF_DIR/agent-board.yml"
LABEL="local.agent-board-tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
VIZ="$HOME/.claude/viz"

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # echo "$(t '中文' 'English')"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

if [ "$HOST" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$PLIST" "$VIZ/remote.json"
  ok "$(t '已停止隧道，看板不再对外开放' 'Tunnel stopped — the board is no longer public')"
  echo "$(t '  隧道本身还留在 Cloudflare 账号里；彻底删除可以运行：' '  The tunnel itself is still in your Cloudflare account; to delete it for good, run: ')cloudflared tunnel delete $NAME"
  exit 0
fi

echo ""
echo "$(t '=== 把看板挂到 Cloudflare ===' '=== Put the board on Cloudflare ===')"
[ -z "$HOST" ] && fail "$(t '要告诉我用哪个网址，例如：' 'Tell me which address to use, e.g. ')bash cloudflare.sh board.example.com"
CFD="$(command -v cloudflared)"
[ -z "$CFD" ] && fail "$(t '没找到 cloudflared。先运行  brew install cloudflared  再来' 'cloudflared not found. Run  brew install cloudflared  first, then try again')"
ok "cloudflared $("$CFD" --version 2>/dev/null | head -1 | awk '{print $3}')"
PORT="$(node -e "try{console.log(require('$VIZ/app/config.json').port||4321)}catch(e){console.log(4321)}" 2>/dev/null)"
[ -z "$PORT" ] && PORT=4321
mkdir -p "$CF_DIR"

echo ""
echo "$(t '[1/4] 登录 Cloudflare' '[1/4] Sign in to Cloudflare')"
if [ -f "$CF_DIR/cert.pem" ]; then
  ok "$(t "已经登录过（$CF_DIR/cert.pem）" "Already signed in ($CF_DIR/cert.pem)")"
else
  echo "$(t "  浏览器会打开 Cloudflare 页面，选中 ${HOST#*.} 这个域名，点 Authorize，然后回到这里" "  Your browser will open Cloudflare. Pick the ${HOST#*.} domain, click Authorize, then come back here")"
  "$CFD" tunnel login || fail "$(t '登录没有完成' "Sign-in didn't complete")"
  ok "$(t '登录完成' 'Signed in')"
fi

echo ""
echo "$(t "[2/4] 准备隧道 $NAME" "[2/4] Setting up tunnel $NAME")"
find_id() { "$CFD" tunnel list -o json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const live=x=>!x.deleted_at||String(x.deleted_at).startsWith('0001');const t=(JSON.parse(s)||[]).find(x=>x.name==='$NAME'&&live(x));console.log(t?t.id:'')}catch(e){console.log('')}})"; }
ID="$(find_id)"
if [ -z "$ID" ]; then
  OUT="$("$CFD" tunnel create "$NAME" 2>&1)" || { echo "$OUT"; fail "$(t '新建隧道失败，上面有原因' "Couldn't create the tunnel (see above)")"; }
  # 新建成功时输出里就有隧道编号；列表接口偶尔慢一拍，所以先从输出里取
  ID="$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  [ -z "$ID" ] && ID="$(find_id)"
fi
[ -z "$ID" ] && fail "$(t '没拿到隧道编号' "Couldn't get the tunnel ID")"
CRED="$CF_DIR/$ID.json"
if [ ! -f "$CRED" ]; then
  "$CFD" tunnel token --cred-file "$CRED" "$ID" >/dev/null 2>&1 || fail "$(t '隧道凭证文件缺失，且无法重新生成' "The tunnel credentials file is missing and couldn't be regenerated")"
fi
ok "$(t "隧道 $NAME（$ID）" "Tunnel $NAME ($ID)")"
cat > "$CONF" <<CONF
# 由 agent-viz/cloudflare.sh 生成：只给看板用
tunnel: $ID
credentials-file: $CRED
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:$PORT
  - service: http_status:404
CONF
ok "$(t '配置写入 ' 'Config written to ')$CONF"

echo ""
echo "$(t "[3/4] 绑定网址 $HOST" "[3/4] Pointing $HOST at the tunnel")"
if "$CFD" tunnel route dns --overwrite-dns "$ID" "$HOST" >/tmp/agent-board-dns.log 2>&1; then
  ok "$(t "$HOST 已指向这条隧道" "$HOST now points to this tunnel")"
else
  warn "$(t '自动绑定没成功（常见原因：之前登录 cloudflared 时选的是别的域名）' "Couldn't set up DNS automatically (usually because cloudflared was signed in with a different domain)")"
  warn "$(t "在 Cloudflare 后台给 ${HOST#*.} 加一条 DNS 记录：类型 CNAME，名称 ${HOST%%.*}，内容 $ID.cfargotunnel.com，代理状态打开（橙色云）" "In the Cloudflare dashboard, add a DNS record for ${HOST#*.}: type CNAME, name ${HOST%%.*}, target $ID.cfargotunnel.com, proxied (orange cloud)")"
fi

echo ""
echo "$(t '[4/4] 开机自动运行' '[4/4] Start at login')"
if [ "$(uname)" = "Darwin" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$CFD</string><string>tunnel</string><string>--no-autoupdate</string><string>--config</string><string>$CONF</string><string>run</string><string>$ID</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$VIZ/tunnel.log</string>
  <key>StandardErrorPath</key><string>$VIZ/tunnel.log</string>
</dict>
</plist>
PL
  launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load -w "$PLIST" >/dev/null 2>&1
  ok "$(t '隧道已在后台运行，开机自动启动' 'Tunnel is running in the background and starts at login')"
else
  warn "$(t '这不是 Mac，请手动运行：' "This isn't a Mac — run it yourself: ")cloudflared tunnel --config $CONF run $ID"
fi
mkdir -p "$VIZ"
printf '{"url":"https://%s"}\n' "$HOST" > "$VIZ/remote.json"

echo ""
echo "$(t '  等 10 秒，检查网址能不能打开……' '  Waiting 10 seconds, then checking the address…')"
sleep 10
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$HOST/api/health")"
LOC="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "https://$HOST/api/health")"
if [ "$CODE" = "302" ] && echo "$LOC" | grep -q "cloudflareaccess.com"; then
  ok "$(t '网址已通，并且有邮箱验证码登录保护' "It's live and protected by email-code sign-in")"
elif [ "$CODE" = "200" ]; then
  warn "$(t "网址已通，但是没有登录保护：任何人知道网址都能看到。请先在 Cloudflare Zero Trust 里给 $HOST 加上 Access 应用" "It's live but NOT protected — anyone with the address can see it. Add an Access application for $HOST in Cloudflare Zero Trust first")"
else
  warn "$(t "暂时打不开（状态 $CODE）。DNS 生效可能要一两分钟，稍后在浏览器里打开 https://$HOST 试试；日志在 $VIZ/tunnel.log" "Not reachable yet (status $CODE). DNS can take a minute or two — try https://$HOST in your browser shortly; logs are in $VIZ/tunnel.log")"
fi
echo ""
echo "$(t '=== 完成 ===' '=== Done ===')"
echo "$(t '  任何设备打开：' '  Open on any device: ')https://$HOST"
echo "$(t '  停止对外开放：' '  Stop sharing:       ')bash \"$0\" --remove"
echo ""
