# HTTPS với reverse proxy Nginx

Dùng [hướng dẫn bàn giao](DEPLOYMENT_FOR_TEACHER.md) để cài hoặc nâng cấp bằng Docker Compose. Máy chủ chạy PostgreSQL và FastAPI trong mạng Docker nội bộ. Nếu Nginx trên máy chủ dùng để kết thúc HTTPS, cấu hình Compose với `APP_HTTP_BIND=127.0.0.1` và `APP_HTTP_PORT=8080`.

Trỏ DNS của tên miền thật về máy chủ. Thêm virtual host vào Nginx trên máy chủ và đổi tên miền ở ví dụ sau:

```nginx
server {
    listen 80;
    server_name survey.example.edu.vn;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Chạy `sudo nginx -t` và reload Nginx. Dùng chứng chỉ của đơn vị hoặc công cụ cấp TLS đang dùng trên máy chủ để phục vụ tên miền qua HTTPS. Giữ cổng PostgreSQL trong mạng Docker. Sau khi bật TLS, kiểm tra `https://<ten-mien>/`, `/admin` và `/health/ready` qua reverse proxy.
