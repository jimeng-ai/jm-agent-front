FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install
COPY . .
# 压低 V8 堆上限。Node 默认按 VM 总内存(7.9G)推出 ~4G 堆，于是 vite build 一路涨到
# 超过实际可用内存(~1.5G)才被 OOM killer 杀，而不是提前 GC。显式设上限让它主动回收。
# 与 vite.config.ts 里关掉的 sourcemap 是同一件事的两半，改一个之前先看另一个的注释。
ENV NODE_OPTIONS=--max-old-space-size=1536
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
