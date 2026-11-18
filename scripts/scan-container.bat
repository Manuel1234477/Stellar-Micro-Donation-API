@echo off
REM Local Container Vulnerability Scanning Script (Windows)
REM
REM This script builds the Docker image and scans it for vulnerabilities
REM using Trivy. It's meant for local development testing before pushing.
REM
REM Usage:
REM   scripts\scan-container.bat [OPTIONS]
REM
REM Options:
REM   --severity <SEVERITY>   Comma-separated severity levels
REM                          Default: CRITICAL,HIGH
REM   --format <FORMAT>       Output format: table, json, sarif
REM                          Default: table
REM   --output <FILE>         Output file path (optional)
REM   --exit-code            Exit with code 1 if vulnerabilities found
REM   --no-build             Skip building the Docker image
REM   --help                 Show help message
REM

setlocal EnableDelayedExpansion

REM Default values
set SEVERITY=CRITICAL,HIGH
set FORMAT=table
set OUTPUT=
set EXIT_CODE_FLAG=
set BUILD_IMAGE=true
set IMAGE_TAG=stellar-micro-donation-api:local-scan

REM Parse arguments
:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="--severity" (
    set SEVERITY=%~2
    shift
    shift
    goto parse_args
)
if "%~1"=="--format" (
    set FORMAT=%~2
    shift
    shift
    goto parse_args
)
if "%~1"=="--output" (
    set OUTPUT=%~2
    shift
    shift
    goto parse_args
)
if "%~1"=="--exit-code" (
    set EXIT_CODE_FLAG=--exit-code 1
    shift
    goto parse_args
)
if "%~1"=="--no-build" (
    set BUILD_IMAGE=false
    shift
    goto parse_args
)
if "%~1"=="--help" (
    echo Usage: scripts\scan-container.bat [OPTIONS]
    echo.
    echo Options:
    echo   --severity SEVERITY   Comma-separated severity levels (default: CRITICAL,HIGH^)
    echo   --format FORMAT       Output format: table, json, sarif (default: table^)
    echo   --output FILE         Output file path
    echo   --exit-code          Exit with code 1 if vulnerabilities found
    echo   --no-build           Skip building the Docker image
    echo   --help               Show this help message
    exit /b 0
)
echo Unknown option: %~1
echo Use --help for usage information
exit /b 1

:end_parse

echo ============================================================
echo   Container Image Vulnerability Scanner
echo ============================================================
echo.

REM Check if Docker is available
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Docker is not installed or not in PATH
    exit /b 1
)

REM Check if Trivy is available
where trivy >nul 2>&1
if %errorlevel% neq 0 (
    echo Trivy not found. Using Docker to run Trivy...
    echo.
    set TRIVY_CMD=docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy
) else (
    set TRIVY_CMD=trivy
)

REM Build the Docker image
if "%BUILD_IMAGE%"=="true" (
    echo Building Docker image...
    echo Image: %IMAGE_TAG%
    echo.
    
    docker build -t %IMAGE_TAG% .
    if %errorlevel% neq 0 (
        echo.
        echo Docker build failed
        exit /b 1
    )
    echo.
    echo Docker image built successfully
    echo.
) else (
    echo Skipping Docker build (--no-build flag^)
    echo.
)

REM Run Trivy scan
echo Running vulnerability scan...
echo Severity: %SEVERITY%
echo Format: %FORMAT%
if not "%OUTPUT%"=="" (
    echo Output: %OUTPUT%
)
echo.

REM Build Trivy command
set TRIVY_COMMAND=%TRIVY_CMD% image --severity %SEVERITY% --format %FORMAT%

if not "%OUTPUT%"=="" (
    set TRIVY_COMMAND=!TRIVY_COMMAND! --output %OUTPUT%
)

if not "%EXIT_CODE_FLAG%"=="" (
    set TRIVY_COMMAND=!TRIVY_COMMAND! %EXIT_CODE_FLAG%
)

REM Add allowlist if exists
if exist ".trivyignore" (
    set TRIVY_COMMAND=!TRIVY_COMMAND! --ignorefile .trivyignore
    echo Using allowlist from .trivyignore
    echo.
)

set TRIVY_COMMAND=!TRIVY_COMMAND! %IMAGE_TAG%

echo Running: !TRIVY_COMMAND!
echo.
echo ============================================================
echo.

!TRIVY_COMMAND!
set SCAN_EXIT_CODE=%errorlevel%

echo.
echo ============================================================

if %SCAN_EXIT_CODE% equ 0 (
    echo Scan completed successfully
    if not "%OUTPUT%"=="" (
        echo Report saved to: %OUTPUT%
    )
    echo.
    echo No vulnerabilities found with severity: %SEVERITY%
) else (
    if not "%EXIT_CODE_FLAG%"=="" (
        echo Scan failed - vulnerabilities found
        echo.
        echo Next steps:
        echo   1. Review the findings above
        echo   2. Update base image or dependencies
        echo   3. If unfixable, add to .trivyignore with justification
        echo   4. See docs\container-security.md for guidance
    ) else (
        echo Vulnerabilities found
        echo.
        echo To fail on findings, run with: --exit-code
        set SCAN_EXIT_CODE=0
    )
)

echo ============================================================

exit /b %SCAN_EXIT_CODE%
