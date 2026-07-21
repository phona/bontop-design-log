#!/usr/bin/env python3
"""Launch Edge with remote debugging and capture floor plan screenshot."""

import subprocess
import time
import sys
from pathlib import Path

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from capture_floor_plan_screenshot import (
    build_cdp_url,
    find_page_ws_url,
    capture_floor_plan_screenshot,
    save_data_url,
)

OUTPUT_PATH = "/home/tao/projects/bontop-design-log/screenshots/floorplan-701-v9.png"
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
APP_URL = "http://localhost:5173"
CDP_PORT = 9222

def launch_edge():
    """Launch Edge with remote debugging enabled."""
    # Use cmd.exe to launch Edge on Windows
    cmd = [
        "cmd.exe", "/c", "start", "msedge",
        "--remote-debugging-port=9222",
        "http://localhost:5173",
    ]
    print(f"Launching Edge via cmd.exe")
    process = subprocess.Popen(cmd)
    return process

def wait_for_cdp(max_wait=30):
    """Wait for CDP to become available."""
    import requests
    cdp_url = build_cdp_url("localhost", CDP_PORT)
    start = time.time()
    while time.time() - start < max_wait:
        try:
            resp = requests.get(cdp_url, timeout=2)
            if resp.status_code == 200:
                print("CDP is available")
                return True
        except Exception:
            pass
        time.sleep(1)
    print("Timeout waiting for CDP")
    return False

def main():
    # Launch Edge
    edge_process = launch_edge()
    
    # Wait for CDP to be available
    if not wait_for_cdp():
        print("Failed to connect to CDP")
        edge_process.terminate()
        return 1
    
    # Wait a bit more for page to load
    time.sleep(3)
    
    try:
        # Find the page WebSocket URL
        cdp_url = build_cdp_url("localhost", CDP_PORT)
        ws_url = find_page_ws_url(cdp_url, APP_URL)
        print(f"Found page: {ws_url}")
        
        # Capture screenshot
        data_url = capture_floor_plan_screenshot(ws_url)
        
        # Save to file
        out_path = save_data_url(data_url, OUTPUT_PATH)
        print(f"Screenshot saved to: {out_path}")
        
        # Get file info
        file_size = out_path.stat().st_size
        print(f"File size: {file_size} bytes")
        
        return 0
    except Exception as e:
        print(f"Error: {e}")
        return 1
    finally:
        # Close Edge
        print("Closing Edge...")
        edge_process.terminate()
        try:
            edge_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            edge_process.kill()

if __name__ == "__main__":
    sys.exit(main())
