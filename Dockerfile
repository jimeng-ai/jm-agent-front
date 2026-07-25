FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install
COPY . .
# 注意：CI 已【不再】走这个多阶段 Dockerfile —— 在本机 prod 的 Docker VM 里跑 vite build
# 会被 OOM killer 打死（VM 7.75G，常驻容器占掉大半，可用 ~1.6G，构建峰值需 ≥1.5G）。
# 线上部署用 Dockerfile.dist：宿主机原生构建出 dist，Docker 只负责装进 nginx。
# 本文件保留给内存充足的机器 / 别处部署的「自洽构建」场景，产出的镜像与 Dockerfile.dist 等价。
# 这里【不要】加 NODE_OPTIONS 堆上限：那是给内存不足的机器打的补丁，在正常机器上反而会
# 让本可成功的构建报 "JavaScript heap out of memory"。
RUN npm run build

FROM nginx:1.27-alpine
# 选择 nginx 配置：
#   nginx.deploy.conf  -> 后端走宿主机生产网关 host.docker.internal:20011（单机/本 Mac 部署，默认；10011 留给本地 IDE）
#   nginx.conf         -> 后端走 docker 网络内的 data-service-gateway:8080（compose 部署）
ARG NGINX_CONF=nginx.deploy.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
