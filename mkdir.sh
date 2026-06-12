#!/usr/bin/expect -f
set timeout 180
set password "<OLD_SERVER_PASSWORD_REMOVED>"

spawn ssh root@72.56.9.90 "mkdir -p /var/www/lideryprava"
expect "password:"
send "$password\r"
expect "#"
send "exit\r"
expect eof
