# Guide: 100% Free Deployment (Webmin & Oracle Cloud)

This guide outlines how to deploy your HRIS ecosystem for 100% free using either your own local hardware (Webmin) or the Oracle Cloud Always Free tier.

## 1. Local On-Premise (Webmin / Ubuntu)
**Best for:** Offices with an old PC available. 100% privacy and zero recurring costs.

### Prerequisites:
*   A PC with Ubuntu Server installed.
*   Webmin installed (`sudo apt install webmin`).

### Setup Steps:
1.  **Install PHP & MySQL**:
    ```bash
    sudo apt install php-fpm php-mysql php-curl php-gd mysql-server
    ```
2.  **Configure MySQL**: Create the `tdt_ims` database and import your `.sql` dump.
3.  **Host the Backends**:
    *   Place the Kiosk backend folder in `/var/www/hris-kiosk`.
    *   Place the IMS folder in `/var/www/ims`.
    *   Use Webmin's "Apache/Nginx Webserver" module to create virtual hosts for both.
4.  **Python Face Server (Background Service)**:
    *   Copy `intern_face_reg_server` to the server.
    *   Create a `systemd` service to keep it running:
    ```ini
    [Unit]
    Description=HRIS Face Recognition Server
    [Service]
    ExecStart=/path/to/.venv/bin/python app.py
    WorkingDirectory=/var/www/hris-kiosk/intern_face_reg_server
    Restart=always
    [Install]
    WantedBy=multi-user.target
    ```

---

## 2. Oracle Cloud (Always Free ARM Instance)
**Best for:** Access from anywhere with 100% cloud reliability.

### Setup Steps:
1.  **Sign Up**: Create an account at [oracle.com/cloud/free/](https://www.oracle.com/cloud/free/).
2.  **Create Compute Instance**:
    *   Choose **Ampere (ARM)** shape.
    *   Select **4 OCPUs and 24GB RAM** (this is all free!).
    *   OS: Ubuntu 22.04.
3.  **Open Ports**:
    *   In the Oracle Dashboard under "Security Lists", add Ingress Rules for ports `80`, `443`, `8000`, `8001`, and `5001`.
4.  **Deployment**: Follow the same Linux setup steps as the Webmin guide above.

---

## 3. Dynamic IP Configuration (Kiosk)
When you deploy to production, you will need to update your Kiosk `.env` and `backend.ts` one last time with your **Server's Public IP** or **Domain Name**.

**Pro Tip:** If you use a local office server, you can use **ngrok** (free tier) to get a public URL for your IMS so interns can register from home.

## Pros and Cons

| Feature | Local (Webmin) | Oracle Cloud Free |
| :--- | :--- | :--- |
| **Cost** | 100% Free | 100% Free |
| **Performance** | Limited by your hardware | Excellent (24GB RAM) |
| **Accessibility** | Local network only (usually) | Publicly accessible |
| **Maintenance** | High (you manage hardware) | Low (Cloud-managed) |
| **Privacy** | Maximum (Data stays in office) | Standard Cloud Privacy |
