"""
Fusion 360 Add-In entry point.

Install: copy this whole "HarmonicDriveGenerator" folder into your Fusion 360
Scripts/Add-Ins location (Fusion 360 > Utilities > Add-Ins > Add-Ins tab >
green "+" > select this folder), then run it. It adds a "하모닉 드라이브 생성"
button to the Design workspace's SOLID > Create panel.
"""
import traceback

import adsk.core

from .commands.generate_command import GenerateCommand

app = None
ui = None
_generate_command = None


def run(context):
    global app, ui, _generate_command
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        _generate_command = GenerateCommand(app, ui)
        _generate_command.start()
    except Exception:
        if ui:
            ui.messageBox("HarmonicDriveGenerator 시작 실패:\n{}".format(traceback.format_exc()))


def stop(context):
    try:
        if _generate_command:
            _generate_command.stop()
    except Exception:
        if ui:
            ui.messageBox("HarmonicDriveGenerator 종료 실패:\n{}".format(traceback.format_exc()))
