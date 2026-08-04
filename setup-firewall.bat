@echo off
chcp 65001 >nul
echo Ajout de la regle de pare-feu EasyTransfert (port 4455, profil prive uniquement).
netsh advfirewall firewall delete rule name="EasyTransfert" >nul 2>&1
netsh advfirewall firewall add rule name="EasyTransfert" dir=in action=allow protocol=TCP localport=4455 profile=private
if %errorlevel% neq 0 (
  echo.
  echo Echec. Ce script doit etre lance en tant qu'administrateur :
  echo clic droit sur setup-firewall.bat, puis "Executer en tant qu'administrateur".
) else (
  echo.
  echo Regle ajoutee. Vous pouvez lancer easytransfert.bat.
)
pause
