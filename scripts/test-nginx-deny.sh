#!/usr/bin/env bash
# 验证 nginx.deploy.conf（公网入口，cloudflared → 10012）：运营接口和沙箱内部回调一律 403，其余 /data 照常转发。
# 用真实的 nginx:1.27-alpine 起一遍配置；上游换成一个总是返回 200 的桩。需要 Docker（部署流程里执行）。
set -euo pipefail
cd "$(dirname "$0")/.."
suffix="$$"
NET="nginx-deny-test-$suffix"; STUB="nginx-deny-stub-$suffix"; EDGE="nginx-deny-edge-$suffix"
TMP="$(mktemp -d)"
cleanup() {
  docker rm -f "$STUB" "$EDGE" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
cat > "$TMP/stub.conf" <<'EOF'
server { listen 80; location / { default_type text/plain; return 200 "upstream"; } }
EOF
docker run -d --name "$STUB" --network "$NET" \
  -v "$TMP/stub.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine >/dev/null

# 被测配置只换上游地址（生产网关 → 桩），其余原样
sed "s#http://192.168.65.254:20011/data/#http://$STUB/data/#" nginx.deploy.conf > "$TMP/edge.conf"
grep -q "$STUB" "$TMP/edge.conf" || { echo "FAIL: 没找到要替换的上游地址，nginx.deploy.conf 的 proxy_pass 变了"; exit 1; }
mkdir -p "$TMP/html" && echo "spa" > "$TMP/html/index.html"
docker run -d --name "$EDGE" --network "$NET" -p 127.0.0.1::80 \
  -v "$TMP/edge.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$TMP/html:/usr/share/nginx/html:ro" nginx:1.27-alpine >/dev/null
PORT="$(docker port "$EDGE" 80/tcp | head -1 | sed 's/.*://')"

for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done

fails=0
check() {   # $1 = 路径（原样发出，不让 curl 规范化），$2 = 期望状态码。用 GET：nginx 对静态文件的 POST 回 405。
  local got
  got="$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1")"
  if [ "$got" = "$2" ]; then echo "ok   $1 -> ${got}"; else echo "FAIL $1 -> ${got}（期望 ${2}）"; fails=1; fi
}

# 必须拦住
check "/data/admin/operator/auth/login"               403
check "/data/admin/operator/enterprises"              403
check "/data/admin/operator"                          403
check "/data/admin/operator;x=1/auth/login"           403   # Spring 会把 ;参数 当成同一路径
check "/data//admin/operator/auth/login"              403   # 双斜杠
check "/data/admin/%6Fperator/auth/login"             403   # 百分号编码
check "/data/ADMIN/Operator/auth/login"               403   # 大小写
check "/data/internal/connector-agent/conn_list"      403
check "/data/internal;x=1/semantic-agent/submit"      403
# 不能误伤
check "/data/admin/auth/login"                        200
check "/data/admin/operators-report"                  200   # 只是前缀相似
check "/data/rag/search"                              200
check "/data/internals"                               200
check "/console/agents"                               200   # SPA 回退

exit "$fails"
