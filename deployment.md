# CDS Test Portal - Deployment & Production Optimization Guide

## 1. Environment Configurations
Prepare a `.env` file for your production server with the following:
```env
PORT=80
DB_HOST=your_cloud_database_endpoint
DB_USER=your_production_user
DB_PASSWORD=your_production_secure_password
DB_NAME=cds_production_db
JWT_SECRET=a_very_long_secure_random_string_do_not_share
```

## 2. Setting Up the Production Server
For deployment on an AWS EC2 instance, DigitalOcean Droplet, or similar:

1. **Install Dependencies:**
   - Install Node.js (v18+)
   - Install MySQL Server (if not using managed DB)
   - Install PM2 (Process Manager): `npm install -g pm2`
   - Install Nginx (For reverse proxying)

2. **Clone and Install:**
   ```bash
   git clone <your-repository-url>
   cd cds-test-portal
   npm install --production
   ```

3. **Start the Application with PM2:**
   PM2 ensures the server restarts if it crashes and handles multiple CPU cores.
   ```bash
   pm2 start server.js --name "cds-test-portal" -i max
   pm2 save
   pm2 startup
   ```

## 3. Reverse Proxy with Nginx
Configure Nginx to forward port 80/443 traffic to your Node server (running on port 5000 internally).
Create a file at `/etc/nginx/sites-available/cds_portal`:
```nginx
server {
    listen 80;
    server_name yourdomain.com; # Replace with your actual domain

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/cds_portal /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 4. Load Testing for Hundreds of Students
To ensure stability during a test when 500+ students log in simultaneously:
- Use **Artillery** or **Apache JMeter** to simulate peak load.
- Sample Artillery configuration (`load-test.yaml`):
  ```yaml
  config:
    target: "http://yourdomain.com"
    phases:
      - duration: 60
        arrivalRate: 20
  scenarios:
    - flow:
        - get:
            url: "/api/health"
  ```
- Run: `npx artillery run load-test.yaml`

## 5. Security & Optimizations
- **HTTPS:** Secure the platform using free SSL from Let's Encrypt (`sudo apt install certbot python3-certbot-nginx` -> `sudo certbot --nginx -d yourdomain.com`).
- **Database Indexing:** Ensure indices exist on the `student_id` and `test_id` columns in the `Test_Results` and `Questions` tables for rapid read access during the test.
- **DDoS Protection:** Consider routing traffic through Cloudflare for caching and DDoS mitigation before traffic reaches your server.
