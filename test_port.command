#!/bin/bash
# Test xem port 8000 có mở không
result=$(curl -s -o /tmp/pclick_test_result.json -w "%{http_code}" http://localhost:8000/health/live 2>&1)
echo "HTTP_CODE=$result" > "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt"
cat /tmp/pclick_test_result.json >> "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt" 2>/dev/null
echo "" >> "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt"

# Also check processes
echo "--- PROCESSES ---" >> "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt"
ps aux | grep uvicorn >> "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt"
echo "--- LOG ---" >> "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt"
cat /tmp/pclick_backend.log >> "/Users/mac/Desktop/PCLICK CODE/port_test_result.txt" 2>/dev/null
