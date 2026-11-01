#!/bin/bash
cd "$(dirname "$0")"
echo "Abriendo Finanzas en pareja..."
( sleep 1.5 && open "http://localhost:4173" ) &
npm start
