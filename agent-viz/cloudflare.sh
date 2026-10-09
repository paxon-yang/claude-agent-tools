#!/bin/bash
# 用 Cloudflare 隧道把看板挂到你自己的域名上，任何设备的浏览器都能打开（配合 Cloudflare Access 邮箱验证码登录）
# 用法：  bash cloudflare.sh board.你的域名
# 移除：  bash cloudflare.sh --remove
# 只新建一条名为 agent-board 的隧道和它自己的配置文件 ~/.cloudflared/agent-board.yml，
# 不会改动你给其他项目配的 cloudflared 设置。

HOST="$1"
NAME="agent-board"
CF_DIR="$HOME/.cloudflared"
CONF="$CF_DIR/agent-board.yml"
LABEL="local.agent-board-tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
VIZ="$HOME/.claude/viz"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

if [ "$HOST" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$PLIST" "$VIZ/remote.json"
  ok "已停止隧道，看板不再对外开放"
  echo "  隧道本身还留在 Cloudflare 账号里；彻底删除可以运行：cloudflared tunnel delete $NAME"
  exit 0
fi

echo ""
echo "=== 把看板挂到 Cloudflare ==="
[ -z "$HOST" ] && fail "要告诉我用哪个网址，例如：bash cloudflare.sh board.peakpointadvisory.co.za"
CFD="$(command -v cloudflared)"
[ -z "$CFD" ] && fail "没找到 cloudflared。先运行  brew install cloudflared  再来"
ok "cloudflared $("$CFD" --version 2>/dev/null | head -1 | awk '{print $3}')"
PORT="$(node -e "try{console.log(require('$VIZ/app/config.json').port||4321)}catch(e){console.log(4321)}" 2>/dev/null)"
[ -z "$PORT" ] && PORT=4321
mkdir -p "$CF_DIR"

echo ""
echo "[1/4] 登录 Cloudflare"
if [ -f "$CF_DIR/cert.pem" ]; then
  ok "已经登录过（$CF_DIR/cert.pem）"
else
  echo "  浏览器会打开 Cloudflare 页面，选中 ${HOST#*.} 这个域名，点 Authorize，然后回到这里"
  "$CFD" tunnel login || fail "登录没有完成"
  ok "登录完成"
fi

echo ""
echo "[2/4] 准备隧道 $NAME"
find_id() { "$CFD" tunnel list -o json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const t=JSON.parse(s).find(x=>x.name==='$NAME'&&!x.deleted_at);console.log(t?t.id:'')}catch(e){console.log('')}})"; }
ID="$(find_id)"
if [ -z "$ID" ]; then
  "$CFD" tunnel create "$NAME" >/dev/null 2>&1 || fail "新建隧道失败，上面有原因"
  ID="$(find_id)"
fi
[ -z "$ID" ] && fail "没拿到隧道编号"
CRED="$CF_DIR/$ID.json"
if [ ! -f "$CRED" ]; then
  "$CFD" tunnel token --cred-file "$CRED" "$ID" >/dev/null 2>&1 || fail "隧道凭证文件缺失，且无法重新生成"
fi
ok "隧道 $NAME（$ID）"
cat > "$CONF" <<CONF
# 由 agent-viz/cloudflare.sh 生成：只给看板用
tunnel: $ID
credentials-file: $CRED
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:$PORT
  - service: http_status:404
CONF
ok "配置写入 $CONF"

echo ""
echo "[3/4] 绑定网址 $HOST"
if "$CFD" tunnel route dns --overwrite-dns "$ID" "$HOST" >/tmp/agent-board-dns.log 2>&1; then
  ok "$HOST 已指向这条隧道"
else
  warn "自动绑定没成功（常见原因：之前登录 cloudflared 时选的是别的域名）"
  warn "在 Cloudflare 后台给 ${HOST#*.} 加一条 DNS 记录：类型 CNAME，名称 ${HOST%%.*}，内容 $ID.cfargotunnel.com，代理状态打开（橙色云）"
fi

echo ""
echo "[4/4] 开机自动运行"
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
  ok "隧道已在后台运行，开机自动启动"
else
  warn "这不是 Mac，请手动运行：cloudflared tunnel --config $CONF run $ID"
fi
mkdir -p "$VIZ"
printf '{"url":"https://%s"}\n' "$HOST" > "$VIZ/remote.json"

echo ""
echo "  等 10 秒，检查网址能不能打开……"
sleep 10
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$HOST/api/health")"
LOC="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "https://$HOST/api/health")"
if [ "$CODE" = "302" ] && echo "$LOC" | grep -q "cloudflareaccess.com"; then
  ok "网址已通，并且有邮箱验证码登录保护"
elif [ "$CODE" = "200" ]; then
  warn "网址已通，但是没有登录保护：任何人知道网址都能看到。请先在 Cloudflare Zero Trust 里给 $HOST 加上 Access 应用"
else
  warn "暂时打不开（状态 $CODE）。DNS 生效可能要一两分钟，稍后在浏览器里打开 https://$HOST 试试；日志在 $VIZ/tunnel.log"
fi
echo ""
echo "=== 完成 ==="
echo "  任何设备打开：https://$HOST"
echo "  停止对外开放：bash \"$0\" --remove"
echo ""
