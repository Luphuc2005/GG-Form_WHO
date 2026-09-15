# Multi-stage Dockerfile for React/Vite Frontend
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package definition
COPY package*.json ./
RUN npm install

# Copy source code and build production static files
COPY . .
RUN npm run build

# Production static web server (Nginx Alpine)
FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
