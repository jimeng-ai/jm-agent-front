#!/usr/bin/env bash
# scripts/test-nginx-deny.sh 自己的测试：nginx 起不来或不响应时，要打出 nginx 的日志再失败。
# docker 换成只按剧本回话的桩，不需要 Docker。拦截规则本身由 test-nginx-deny.sh 用真 nginx 测。
#
# 背景：nginx 配置写错时容器会马上退出，旧脚本接着执行 docker port，只留下一句
# "no public port '80/tcp' published"，看不出是配置哪一行错了。
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
# 剧本：EDGE_RUNNING 决定 inspect 的回答；被测的 edge 容器名以 nginx-deny-edge- 开头。
case "$1" in
  inspect) echo "${EDGE_RUNNING}" ;;
  port)    [ "${EDGE_RUNNING}" = "true" ] && echo "127.0.0.1:${EDGE_PORT}" || { echo "Error: No public port '80/tcp' published" >&2; exit 1; } ;;
  logs)    echo 'nginx: [emerg] unexpected ";" in /etc/nginx/conf.d/default.conf:15' ;;
esac
exit 0
EOF
chmod +x "$TMP/bin/docker"

fails=0
# $1 说明，$2 EDGE_RUNNING，$3 输出里应当出现的说明
run_case() {
  local out rc=0
  out="$(PATH="$TMP/bin:$PATH" EDGE_RUNNING="$2" EDGE_PORT=9 bash scripts/test-nginx-deny.sh 2>&1)" || rc=$?
  if [ "$rc" != 0 ] && grep -qF -- "$3" <<<"$out" && grep -qF -- '[emerg]' <<<"$out"; then
    echo "ok   ${1}"
  else
    echo "FAIL ${1}（退出码 ${rc}）"; printf '%s\n' "$out" | tail -6 | sed 's/^/       /'; fails=1
  fi
}

run_case "nginx 一启动就退出：失败并打出 nginx 日志" false "nginx 没起来"
run_case "nginx 在跑但一直不响应：等满后失败并打出 nginx 日志" true "没有响应"
exit "$fails"
