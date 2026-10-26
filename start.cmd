@echo off
rem Start Randomy backend and frontend, then open the browser.
set "PYTHONPATH=%~dp0backend\src;%PYTHONPATH%"
uv run --project "%~dp0backend" python -m randomy.launcher %*
