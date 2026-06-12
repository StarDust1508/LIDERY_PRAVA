#!/usr/bin/expect -f
set password "<OLD_SERVER_PASSWORD_REMOVED>"
set timeout 60

spawn scp nginx_lideryprava.conf lideryprava.service root@72.56.9.90:/tmp/
expect "password:"
send "$password\r"
expect eof
