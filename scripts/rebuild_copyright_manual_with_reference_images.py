from __future__ import annotations

import runpy
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "copyright-material"
REFERENCE_DOCX = OUT_DIR / "AI影视全流程工作流系统_软件使用说明书_宽屏脱敏提交版_V1.0.docx"
REFERENCE_IMAGE_DIR = OUT_DIR / "reference-docx-images"
OUTPUT_DOCX = OUT_DIR / "AI影视全流程工作流系统_软件使用说明书_宽屏参考图版_V1.0.docx"
BASE_SCRIPT = ROOT / "scripts" / "rebuild_copyright_manual_with_images.py"


REFERENCE_SECTIONS = [
    {
        "title": "系统首页",
        "path": "浏览器访问系统首页",
        "image": "01_image1.png",
        "desc": "系统首页展示软件名称、系统定位和进入入口，用于引导用户开始使用 AI 影视全流程工作流系统。",
        "steps": ["用户在浏览器地址栏输入系统访问地址。", "系统展示软件名称、定位说明和登录入口。", "用户点击进入系统，跳转至账号登录界面。"],
    },
    {
        "title": "登录界面",
        "path": "首页 - 登录账号",
        "image": "02_image2.png",
        "desc": "登录界面用于用户身份验证，保证项目数据、生成资产和后台权限隔离。",
        "steps": ["用户输入邮箱和密码。", "系统调用认证服务校验用户身份。", "登录成功后进入项目仪表盘或目标项目页面。"],
    },
    {
        "title": "项目仪表盘",
        "path": "登录成功 - 仪表盘",
        "image": "03_image3.png",
        "desc": "项目仪表盘展示统计数据、项目列表、新建项目入口和最近项目状态，便于用户查看整体工作情况。",
        "steps": ["系统读取当前用户的项目列表和统计数据。", "页面展示进行中项目、资产数量、视频片段等概览信息。", "用户可新建项目或进入已有项目继续制作。"],
    },
    {
        "title": "项目总览",
        "path": "仪表盘 - 选择项目 - 项目总览",
        "image": "04_image4.png",
        "desc": "项目总览展示当前项目的基础信息、整体进度、最近资产和工作流入口，帮助用户把握项目全局状态。",
        "steps": ["用户从仪表盘进入指定项目。", "系统展示项目标题、工作流完成进度和资产概览。", "用户可进入工作流、资产库或其他项目功能。"],
    },
    {
        "title": "项目资产库",
        "path": "项目 - 资产库",
        "image": "05_image5.png",
        "desc": "资产库统一管理图片、视频、音频、文本和参考素材，支持按类型查看与预览生成结果。",
        "steps": ["用户进入项目资产库。", "系统读取项目关联资产。", "用户按资产类型查看、预览或下载项目成果。"],
    },
    {
        "title": "分镜编辑器",
        "path": "项目 - 分镜设计页面",
        "image": "06_image6.png",
        "desc": "分镜编辑器支持镜头表格、画面查看、分镜文本编辑和导出，便于用户对镜头内容进行精细调整。",
        "steps": ["用户打开分镜设计页面。", "系统展示镜头编号、画面描述、运镜、时长和参考画面。", "用户可编辑、排序并导出分镜文件。"],
    },
    {
        "title": "充值管理",
        "path": "设置 - 充值",
        "image": "07_image7.png",
        "desc": "充值页面展示点数余额、充值记录和凭证提交入口，用于支持 AI 生成任务的点数消耗。",
        "steps": ["用户进入充值页面。", "系统展示当前点数和充值记录。", "用户提交充值金额和凭证，等待管理员审核。"],
    },
    {
        "title": "管理后台",
        "path": "管理员入口 - 用户统计",
        "image": "08_image8.png",
        "desc": "管理后台提供用户统计、充值审核、请求统计和项目查看能力，用于系统运营管理。",
        "steps": ["管理员进入后台页面。", "系统展示用户列表、点数和操作入口。", "管理员可查看用户项目、调整点数或审核充值订单。"],
    },
    {
        "title": "工作流看板",
        "path": "项目 - 工作流看板",
        "image": "09_image9.png",
        "desc": "工作流看板展示九步影视创作流程、步骤状态和当前操作入口，是项目生成任务的主控页面。",
        "steps": ["用户进入工作流看板。", "系统展示参考素材、工作流步骤和当前进度。", "用户按顺序进入各步骤生成或确认内容。"],
    },
    {
        "title": "创意扩散",
        "path": "工作流看板 - 创意扩散",
        "image": "10_image10.png",
        "desc": "创意扩散步骤根据原始元构思生成多个创意方向，帮助用户确定项目后续制作的主题和表达角度。",
        "steps": ["用户进入创意扩散步骤。", "系统展示多个候选创意方向、标签和简要说明。", "用户选择合适方向作为后续框架搭建的输入。"],
    },
    {
        "title": "框架搭建",
        "path": "工作流看板 - 框架搭建",
        "image": "11_image11.png",
        "desc": "框架搭建生成故事梗概、角色设定、幕结构、环境设定和视觉风格，是后续图像与视频生成的结构化基础。",
        "steps": ["用户点击框架搭建步骤。", "系统展示已生成的故事框架内容。", "用户可编辑文本字段，并使用深化功能补充细节。"],
    },
    {
        "title": "风格统一",
        "path": "工作流看板 - 风格统一",
        "image": "12_image12.png",
        "desc": "风格统一生成多组视觉风格样图，用户选择其中一组作为后续人物、概念图和视频生成的统一视觉基准。",
        "steps": ["用户进入风格统一步骤。", "系统展示多张风格样图、模型标记和风格说明。", "用户选择符合项目基调的风格图并设为后续生成基准。"],
    },
    {
        "title": "人物设计",
        "path": "工作流看板 - 人物设计",
        "image": "13_image13.png",
        "desc": "人物设计基于角色设定和统一风格图生成角色概念图，形成后续场景图和视频生成的角色参考资产。",
        "steps": ["系统读取框架中的角色列表。", "用户查看角色设定、提示词和已生成角色图。", "用户可对单个角色重新生成或调整提示词。"],
    },
    {
        "title": "概念图生成",
        "path": "工作流看板 - 概念图",
        "image": "14_image14.png",
        "desc": "概念图步骤按幕结构生成关键场景图，并结合风格参考和角色参考形成项目视觉蓝图。",
        "steps": ["用户进入概念图步骤。", "系统按幕展示场景提示词和生成结果。", "用户可确认、预览或对单张概念图重新生成。"],
    },
    {
        "title": "宣传片生成",
        "path": "工作流看板 - 宣传片",
        "image": "15_image15.png",
        "desc": "宣传片步骤基于概念图序列生成多个视频片段，并支持合成为完整宣传片。",
        "steps": ["系统读取概念图和框架内容。", "用户为片段生成视频提示词并逐段生成视频。", "全部片段完成后系统合成宣传片并保存为视频资产。"],
    },
    {
        "title": "分镜设计",
        "path": "工作流看板 - 分镜设计",
        "image": "16_image16.png",
        "desc": "分镜设计步骤将故事拆解为镜头序列，连接文字脚本、分镜画面和后续视频生成流程。",
        "steps": ["用户进入分镜设计步骤。", "系统展示镜头列表、分镜模式和生成状态。", "用户可进入分镜编辑器进一步调整镜头信息。"],
    },
    {
        "title": "生成首尾帧",
        "path": "工作流看板 - 生成首尾帧",
        "image": "17_image17.png",
        "desc": "生成首尾帧步骤为镜头生成首帧和尾帧，供后续直生视频步骤使用。",
        "steps": ["系统读取分镜步骤中的镜头信息。", "用户查看首帧、尾帧提示词和生成状态。", "系统逐个镜头生成首尾帧并保存结果。"],
    },
    {
        "title": "直生视频",
        "path": "工作流看板 - 直生视频",
        "image": "18_image18.png",
        "desc": "直生视频步骤基于首帧或首尾帧调用图生视频模型生成视频片段，并可拼接为完整视频。",
        "steps": ["用户进入直生视频步骤。", "系统展示视频模型、片段状态和生成入口。", "用户批量生成片段并在完成后拼接视频。"],
    },
]


def extract_reference_images() -> None:
    REFERENCE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    with ZipFile(REFERENCE_DOCX) as archive:
        media = [name for name in archive.namelist() if name.startswith("word/media/")]
        media.sort(key=lambda name: int(Path(name).stem.replace("image", "")))
        for index, name in enumerate(media, 1):
            target = REFERENCE_IMAGE_DIR / f"{index:02d}_{Path(name).name}"
            target.write_bytes(archive.read(name))


def main() -> None:
    extract_reference_images()
    ns = runpy.run_path(str(BASE_SCRIPT))
    build_docx = ns["build_docx"]
    build_docx.__globals__["SCREEN_DIR"] = REFERENCE_IMAGE_DIR
    build_docx.__globals__["OUT_DOCX"] = OUTPUT_DOCX
    build_docx.__globals__["SECTIONS"] = REFERENCE_SECTIONS
    output = build_docx()
    print(output)


if __name__ == "__main__":
    main()
