#!/bin/sh
redis-server --daemonize yes --port 6379
sleep 2
npm start

