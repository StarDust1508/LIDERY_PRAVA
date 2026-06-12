#!/usr/bin/expect -f
set password "<OLD_SERVER_PASSWORD_REMOVED>"
set timeout 90

spawn ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no root@72.56.9.90
expect -re "(?i)password:"
send "$password\r"
expect -re {[$#] $}

send "ls -la /var/www/lideryprava/\r"
expect -re {[$#] $}

send "ls -la /var/www/lideryprava/data/\r"
expect -re {[$#] $}

send "systemctl status lideryprava\r"
expect -re {[$#] $}

send "curl -s http://127.0.0.1:8000/ | head -20\r"
expect -re {[$#] $}

send "ls -la /etc/nginx/sites-enabled/\r"
expect -re {[$#] $}

interact
