@echo off
rem LocalTeX - arranque em Windows (nao precisa de administrador).
rem Usa python-portable\python.exe se existir; senao, o Python do sistema.
cd /d "%~dp0"
if exist "python-portable\python.exe" (
  "python-portable\python.exe" server.py %*
  goto :end
)
where py >nul 2>nul && (py -3 server.py %* & goto :end)
where python >nul 2>nul && (python server.py %* & goto :end)
echo Python nao encontrado. Extraia o "Windows embeddable package" de python.org
echo para a pasta python-portable ao lado deste ficheiro (ver README).
:end
pause
