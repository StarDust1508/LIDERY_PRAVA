#!/usr/bin/expect -f
set password "<OLD_SERVER_PASSWORD_REMOVED>"
set timeout 120

spawn ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no root@72.56.9.90
expect -re "(?i)password:"
send "$password\r"
expect -re {[$#] $}

send "ls -la /var/www/html/\r"
expect -re {[$#] $}

send "cat /etc/nginx/sites-enabled/* 2>/dev/null || echo 'no sites'\r"
expect -re {[$#] $}

send "which python3\r"
expect -re {[$#] $}

send "which certbot || echo 'certbot not found'\r"
expect -re {[$#] $}

interact
