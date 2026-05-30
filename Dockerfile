FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# 选择 nginx 配置：
#   nginx.deploy.conf  -> 后端走宿主机 host.docker.internal:10011（单机/本 Mac 部署，默认）
#   nginx.conf         -> 后端走 docker 网络内的 data-service-gateway:8080（compose 部署）
ARG NGINX_CONF=nginx.deploy.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
