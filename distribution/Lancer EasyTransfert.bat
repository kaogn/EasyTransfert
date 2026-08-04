@echo off
chcp 65001 >nul
title EasyTransfert
cd /d "%~dp0"

echo.
echo   Démarrage d'EasyTransfert, un instant...
echo.

netsh advfirewall firewall show rule name="EasyTransfert" >nul 2>&1
if %errorlevel% neq 0 (
  echo   Première utilisation : Windows va demander une autorisation.
  echo   Cliquez sur "Oui" pour que le téléphone puisse se connecter.
  echo.
  powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall','firewall','add','rule','name=EasyTransfert','dir=in','action=allow','protocol=TCP','localport=4455-4459','profile=private' -Verb RunAs -Wait" >nul 2>&1
)

"%~dp0node\node.exe" server.js

echo.
echo   EasyTransfert est arrêté. Vous pouvez fermer cette fenêtre.
pause >nul
