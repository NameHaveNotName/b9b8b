from __future__ import annotations

from pathlib import Path
import time

import pyautogui
import pyperclip
from PIL import Image


OUT = Path("output/copyright-material/edge-wide-raw")
OUT.mkdir(parents=True, exist_ok=True)

URL_BASE = "https://b9b8b.vercel.app"
PROJECT_ID = "cmruukm8h000304jr7svj33u4"

# Browser content area for the maximized Edge window on the current 2560x1600 display.
CONTENT_BOX = (4, 118, 2555, 1518)


def wait(seconds: float = 2.0) -> None:
    time.sleep(seconds)


def screenshot(name: str) -> None:
    im = pyautogui.screenshot()
    crop = im.crop(CONTENT_BOX)
    crop.save(OUT / name)
    print(name, crop.size)


def goto(url: str, delay: float = 4.0) -> None:
    pyautogui.hotkey("ctrl", "l")
    pyperclip.copy(url)
    pyautogui.hotkey("ctrl", "v")
    pyautogui.press("enter")
    wait(delay)
    pyautogui.press("home")
    wait(0.5)


def click_step(x: int, name: str) -> None:
    pyautogui.click(x, 482)
    wait(1.0)
    pyautogui.press("home")
    wait(0.25)
    screenshot(name)


def main() -> None:
    # Pages with stable direct URLs.
    pages = [
        ("01_dashboard.png", f"{URL_BASE}/dashboard", 4.0),
        ("02_project_overview.png", f"{URL_BASE}/project/{PROJECT_ID}", 4.0),
        ("03_assets.png", f"{URL_BASE}/project/{PROJECT_ID}/assets", 4.0),
        ("04_storyboard_editor.png", f"{URL_BASE}/project/{PROJECT_ID}/storyboard", 4.0),
        ("05_recharge.png", f"{URL_BASE}/settings/recharges", 4.0),
        ("06_admin_users.png", f"{URL_BASE}/admin/users", 4.0),
        ("07_workflow_overview.png", f"{URL_BASE}/project/{PROJECT_ID}/workflow", 4.5),
    ]
    for name, url, delay in pages:
        goto(url, delay)
        screenshot(name)

    # Workflow steps. Coordinates are the top stepper centers in the current 2560px-wide Edge window.
    steps = [
        (716, "08_ideation.png"),
        (828, "09_framework.png"),
        (942, "10_style.png"),
        (1053, "11_character.png"),
        (1164, "12_concept.png"),
        (1274, "13_trailer.png"),
        (1383, "14_storyboard_step.png"),
        (1493, "15_keyframes.png"),
        (1605, "16_direct_video.png"),
    ]
    goto(f"{URL_BASE}/project/{PROJECT_ID}/workflow", 2.0)
    for x, name in steps:
        click_step(x, name)


if __name__ == "__main__":
    main()
