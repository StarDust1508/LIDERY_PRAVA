#!/usr/bin/expect -f
set password "<OLD_SERVER_PASSWORD_REMOVED>"
set timeout 180

spawn ssh root@72.56.9.90
expect "password:"
send "$password\r"
expect "#"

send "apt-get update && apt-get install -y certbot python3-certbot-nginx\r"
expect "#"
send "y\r"
expect "#"

send "certbot --nginx -d lideryprava.ru -d www.lideryprava.ru --register-unsafely-without-email --agree-tos\r"
expect "#"

interact
