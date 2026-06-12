#!/usr/bin/expect -f
set password "<OLD_SERVER_PASSWORD_REMOVED>"
set timeout 120

spawn ssh root@72.56.9.90
expect "password:"
send "$password\r"
expect "#"

send "certbot --nginx -d lideryprava.ru -d www.lideryprava.ru --register-unsafely-without-email --agree-tos\r"
expect "#"

send "systemctl status lideryprava\r"
expect "#"

interact
