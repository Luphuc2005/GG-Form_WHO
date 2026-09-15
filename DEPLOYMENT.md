# Standard Ubuntu Server Deployment Guide

This guide details the deployment of the **WHO Ovarian Tumor Pathology Survey Web System** on a generic Linux/Ubuntu production server.

---

## 1. Prerequisites & Firewall Setup

Before beginning installation, ensure required inbound ports are opened:
- `80/tcp` (HTTP)
- `443/tcp` (HTTPS)
- `8080/tcp` (Optional, if using internal proxy)

**NEVER open port `5432` to the public internet.** PostgreSQL must remain strictly isolated inside the Docker bridge network.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 2. DNS Configuration

Configure an `A` record with your DNS provider:
```
gpb.example.edu.vn  A  <YOUR_SERVER_PUBLIC_IP>
```
Wait for DNS propagation:
```bash
dig +short gpb.example.edu.vn
```

---

## 3. Clone Repository & Configuration

```bash
sudo mkdir -p /opt/ovarian-survey
sudo chown -R $USER:$USER /opt/ovarian-survey
cd /opt/ovarian-survey

git clone <REPO_URL> .

# Setup environment variables
cp .env.example .env
nano .env
```

Ensure you configure:
- `DOMAIN=gpb.example.edu.vn`
- `POSTGRES_PASSWORD=<STRONG_RANDOM_PASSWORD>`
- `SECRET_KEY=<32_PLUS_CHARS_SECRET>`
- `ADMIN_PASSWORD=<STRONG_ADMIN_PASSWORD>`

---

## 4. Run Server Diagnostics

Execute the non-invasive server verification script:
```bash
chmod +x scripts/*.sh
./scripts/check_server.sh
```

---

## 5. Automated Deployment

Deploy the entire stack with a single command:
```bash
sudo ./scripts/deploy.sh
```

This script:
1. Validates Docker and environment settings.
2. Builds the multi-stage React/Nginx and FastAPI images.
3. Initializes PostgreSQL with persistent named volume `ovarian_survey_postgres_data`.
4. Executes Alembic database migrations.
5. Imports and publishes `form-definitions/ovarian-pathology-v1.json`.
6. Seeds initial admin credentials.
7. Performs automated curl healthchecks against `/health/ready`.

---

## 6. SSL / HTTPS Termination with Let's Encrypt

Install Certbot and request certificates:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d gpb.example.edu.vn
```

Verify automated renewal:
```bash
sudo certbot renew --dry-run
```

---

## 7. Operational Verification

- **Survey Web Application**: `https://gpb.example.edu.vn/`
- **Admin Dashboard**: `https://gpb.example.edu.vn/admin`
- **Health Probe**: `https://gpb.example.edu.vn/health/ready`
