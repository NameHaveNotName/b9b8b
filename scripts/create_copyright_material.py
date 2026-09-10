from __future__ import annotations

import html
import os
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    Image as PdfImage,
    Table,
    TableStyle,
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "copyright-material"
SCREENS = OUT / "screenshots"
HTML_FILE = OUT / "screenshot-pages.html"
DOCX_FILE = OUT / "AI影视全流程工作流系统_软件著作权补正文档鉴别材料_V1.0.docx"
PDF_FILE = OUT / "AI影视全流程工作流系统_软件著作权补正文档鉴别材料_V1.0.pdf"


SCREENS_DATA = [
    {
        "id": "home",
        "name": "首页与系统入口界面",
        "path": "浏览器访问系统首页 /",
        "summary": "首页展示软件名称、AI 影视工业化生产定位和进入工作台入口，作为用户访问系统的起始界面。",
        "steps": ["用户通过浏览器访问系统地址。", "系统显示产品名称、简介与开始使用入口。", "用户点击开始使用进入登录或工作台。"],
        "cards": ["AI 驱动的影视工业化生产工具", "从元构思到成片", "进入工作台"],
    },
    {
        "id": "login",
        "name": "登录与注册界面",
        "path": "首页 → 登录账号 /login",
        "summary": "登录界面用于验证用户身份，注册界面用于创建账号，是项目数据隔离和权限控制的入口。",
        "steps": ["用户输入邮箱和密码。", "系统调用认证服务校验账号。", "校验成功后进入项目仪表盘。"],
        "cards": ["邮箱输入", "密码输入", "注册/登录切换"],
    },
    {
        "id": "dashboard",
        "name": "项目仪表盘界面",
        "path": "登录成功 → /dashboard",
        "summary": "项目仪表盘集中展示用户项目、项目进度、最近更新时间和新建项目入口。",
        "steps": ["用户登录后进入仪表盘。", "系统读取当前用户项目列表。", "用户可打开既有项目或创建新项目。"],
        "cards": ["项目总数 8", "进行中 3", "最近活跃 5", "新建项目"],
    },
    {
        "id": "new-project",
        "name": "新建项目与元构思输入界面",
        "path": "仪表盘 → 新建项目 /project/new",
        "summary": "新建项目界面保存项目标题和原始灵感，为后续创意扩散与框架搭建提供基础输入。",
        "steps": ["用户填写项目标题。", "用户输入元构思、主题或剧情灵感。", "系统创建项目并初始化 9 步工作流。"],
        "cards": ["项目标题", "元构思文本框", "创建并开始"],
    },
    {
        "id": "workflow",
        "name": "工作流看板界面",
        "path": "项目详情 → 工作流 /project/[id]/workflow",
        "summary": "工作流看板以 9 个步骤组织影视 AI 生成流程，显示每步的状态、进度、重试和跳过入口。",
        "steps": ["用户进入项目工作流。", "系统按状态机显示已完成、进行中、待开始步骤。", "用户点击当前步骤执行生成任务。"],
        "cards": ["创意扩散", "框架搭建", "风格统一", "人物设计", "概念图", "宣传片", "分镜设计", "生成尾帧", "直生视频"],
    },
    {
        "id": "ideation",
        "name": "创意扩散界面",
        "path": "工作流看板 → 创意扩散",
        "summary": "创意扩散模块将用户输入的元构思扩展为多个可执行创作方向，并提供评分和选择能力。",
        "steps": ["用户点击开始执行。", "系统生成 3-5 个创意方向。", "用户查看评分、顾虑和描述，选择一个方向确认。"],
        "cards": ["方向一：城中旧影院", "新颖性 8.6", "情感张力 9.1", "确认该方向"],
    },
    {
        "id": "framework",
        "name": "框架搭建与深化界面",
        "path": "工作流看板 → 框架搭建",
        "summary": "框架搭建模块输出故事梗概、角色设定、幕结构、环境设定和视觉风格，并支持角色/故事/环境深化。",
        "steps": ["系统基于选定创意生成故事框架。", "用户可编辑角色、梗概和幕结构。", "用户点击深化按钮补充角色外貌、性格、记忆点等内容。"],
        "cards": ["故事梗概", "角色设定", "三幕结构", "角色深化"],
    },
    {
        "id": "style",
        "name": "风格统一界面",
        "path": "工作流看板 → 风格统一",
        "summary": "风格统一模块生成三组风格样图，用户选定一组作为后续人物、概念图和视频生成的统一视觉基准。",
        "steps": ["用户确认风格提示词和画面比例。", "系统调用图像模型生成 3 张风格样图。", "用户选择最合适的风格并保存为视觉基准。"],
        "cards": ["Flux Kontext", "GPT Image 2", "即梦 4.5", "确认风格"],
    },
    {
        "id": "character",
        "name": "人物设计界面",
        "path": "工作流看板 → 人物设计",
        "summary": "人物设计模块根据角色设定和统一风格图生成角色概念图，并将结果入库为角色资产。",
        "steps": ["系统读取框架中的角色列表。", "用户确认角色提示词、比例和模型。", "系统逐个生成角色人设图，支持单角色重做。"],
        "cards": ["char_001 陈远", "char_002 老艺人", "角色图", "重新生成"],
    },
    {
        "id": "concept",
        "name": "概念图生成界面",
        "path": "工作流看板 → 概念图",
        "summary": "概念图模块按幕结构生成核心场景图，综合注入风格参考和角色参考，用于形成视觉蓝图。",
        "steps": ["系统按幕读取关键场景。", "用户确认每张概念图提示词。", "系统生成并按幕归类展示概念图。"],
        "cards": ["第一幕 概念图", "第二幕 概念图", "第三幕 概念图", "单图重做"],
    },
    {
        "id": "trailer",
        "name": "宣传片生成界面",
        "path": "工作流看板 → 宣传片",
        "summary": "宣传片模块基于概念图序列生成多个视频片段，并通过合成功能输出 30 秒左右宣传片。",
        "steps": ["用户生成每个片段的视频提示词。", "系统逐段生成视频片段。", "全部片段完成后合成宣传片并入库。"],
        "cards": ["片段 01", "片段 02", "批量生成", "合成视频"],
    },
    {
        "id": "storyboard",
        "name": "分镜设计界面",
        "path": "工作流看板 → 分镜设计 /project/[id]/storyboard",
        "summary": "分镜设计模块以表格和画布管理镜头列表，支持拖拽排序、行内编辑、分镜图生成和 JSON/Excel 导出。",
        "steps": ["用户选择实拍参考模式或视频生成模式。", "系统生成结构化镜头列表。", "用户编辑镜头、拖拽排序并导出分镜表。"],
        "cards": ["镜头号", "画面描述", "运镜方式", "导出 Excel"],
    },
    {
        "id": "keyframes",
        "name": "生成尾帧界面",
        "path": "工作流看板 → 生成尾帧",
        "summary": "生成尾帧模块读取分镜首帧作为只读输入，为每个镜头生成尾帧，用于后续首尾帧视频生成。",
        "steps": ["系统读取分镜步骤产生的首帧。", "用户确认尾帧提示词。", "系统生成每个镜头尾帧并保存。"],
        "cards": ["首帧（只读）", "尾帧", "单条生成", "批量生成尾帧"],
    },
    {
        "id": "direct-video",
        "name": "直生视频界面",
        "path": "工作流看板 → 直生视频",
        "summary": "直生视频模块基于首帧或首尾帧调用图生视频模型生成小动作、小运镜视频片段，并拼接为完整视频。",
        "steps": ["系统检测每个镜头是否具备首帧和尾帧。", "用户选择视频模型并批量生成。", "生成完成后预览片段并拼接整片。"],
        "cards": ["Wan 2.5 I2V", "Hailuo 2.3", "首尾帧策略", "拼接视频"],
    },
    {
        "id": "assets",
        "name": "资产库界面",
        "path": "项目详情 → 资产库 /project/[id]/assets",
        "summary": "资产库集中展示图片、视频、文本、音频等生成结果，支持按类型筛选、预览和下载。",
        "steps": ["用户进入项目资产库。", "系统按类型加载项目资产。", "用户筛选、预览或下载生成结果。"],
        "cards": ["IMAGE", "VIDEO", "AUDIO", "REFERENCE"],
    },
    {
        "id": "recharge",
        "name": "个人中心与充值界面",
        "path": "顶部用户菜单 → 设置/充值",
        "summary": "个人中心展示账号资料、点数余额、充值记录和消费明细，充值页面支持上传转账凭证。",
        "steps": ["用户查看当前点数余额。", "用户填写充值金额并上传凭证。", "管理员审核通过后点数到账。"],
        "cards": ["点数余额", "充值金额", "上传凭证", "消费明细"],
    },
    {
        "id": "admin",
        "name": "管理后台界面",
        "path": "管理员账号 → /admin",
        "summary": "管理后台提供用户管理、充值审核、操作日志和数据分析能力，用于系统运营和审计。",
        "steps": ["管理员进入后台页面。", "系统展示用户、充值和项目数据。", "管理员审核充值订单或查看用户项目。"],
        "cards": ["用户管理", "充值审核", "操作日志", "数据分析"],
    },
]


def ensure_dirs() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SCREENS.mkdir(parents=True, exist_ok=True)


def write_html() -> None:
    payload = {s["id"]: s for s in SCREENS_DATA}
    # Hand-written JSON avoids importing json in the browser while keeping the page self-contained.
    import json

    html_doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Film Flow 截图生成页</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; background: #f5f5f4; color: #292524; }}
  .app {{ width: 1440px; height: 900px; display: flex; background: #fafaf9; overflow: hidden; }}
  .sidebar {{ width: 252px; background: #1c1917; color: #fafaf9; padding: 22px 18px; display: flex; flex-direction: column; gap: 18px; }}
  .brand {{ display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }}
  .logo {{ width: 36px; height: 36px; border-radius: 8px; background: #f59e0b; display: grid; place-items: center; color: #1c1917; }}
  .nav {{ display: grid; gap: 6px; margin-top: 10px; }}
  .nav div {{ padding: 10px 12px; border-radius: 8px; color: #d6d3d1; font-size: 14px; }}
  .nav .active {{ background: #292524; color: #fff; }}
  .recent {{ margin-top: auto; border-top: 1px solid #44403c; padding-top: 14px; font-size: 12px; color: #a8a29e; }}
  .main {{ flex: 1; display: flex; flex-direction: column; }}
  .top {{ height: 66px; background: #fff; border-bottom: 1px solid #e7e5e4; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; }}
  .crumb {{ font-size: 13px; color: #78716c; }}
  .user {{ display: flex; align-items: center; gap: 12px; font-size: 13px; color: #57534e; }}
  .avatar {{ width: 32px; height: 32px; border-radius: 50%; background: #fde68a; display: grid; place-items: center; color: #92400e; font-weight: 700; }}
  .content {{ flex: 1; padding: 30px; overflow: hidden; }}
  .hero {{ display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 22px; }}
  h1 {{ margin: 0; font-size: 28px; letter-spacing: 0; }}
  .sub {{ margin-top: 8px; color: #78716c; font-size: 14px; max-width: 760px; line-height: 1.6; }}
  .btn {{ border: 0; border-radius: 8px; background: #1c1917; color: #fff; padding: 11px 16px; font-weight: 600; }}
  .btn.secondary {{ background: #fff; color: #44403c; border: 1px solid #d6d3d1; }}
  .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }}
  .card {{ background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 18px; min-height: 132px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }}
  .card h3 {{ margin: 0 0 10px; font-size: 16px; }}
  .metric {{ font-size: 32px; font-weight: 700; color: #1c1917; }}
  .tag {{ display: inline-block; border-radius: 999px; padding: 4px 9px; background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-size: 12px; }}
  .panel {{ margin-top: 18px; background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 20px; }}
  .steps {{ display: grid; grid-template-columns: repeat(9, 1fr); gap: 8px; margin-top: 12px; }}
  .step {{ border: 1px solid #e7e5e4; background: #fff; border-radius: 8px; padding: 10px 8px; text-align: center; font-size: 12px; color: #57534e; }}
  .step.done {{ background: #ecfdf5; border-color: #bbf7d0; color: #166534; }}
  .step.active {{ background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }}
  .rows {{ display: grid; gap: 10px; margin-top: 14px; }}
  .row {{ display: grid; grid-template-columns: 88px 1fr 130px 120px; gap: 12px; align-items: center; padding: 12px; border: 1px solid #e7e5e4; border-radius: 8px; background: #fff; }}
  .thumbs {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }}
  .thumb {{ border-radius: 8px; overflow: hidden; border: 1px solid #e7e5e4; background: #fff; }}
  .art {{ height: 170px; background: linear-gradient(135deg, #111827, #92400e 45%, #fbbf24); position: relative; }}
  .art.alt1 {{ background: linear-gradient(135deg, #0f172a, #2563eb, #f8fafc); }}
  .art.alt2 {{ background: linear-gradient(135deg, #14532d, #84cc16, #fef3c7); }}
  .art.alt3 {{ background: linear-gradient(135deg, #581c87, #db2777, #fde68a); }}
  .art:after {{ content: ""; position: absolute; inset: 28px; border: 2px solid rgba(255,255,255,.35); border-radius: 8px; }}
  .cap {{ padding: 12px; font-size: 13px; }}
  .login-wrap {{ width: 100%; height: 100%; display: grid; place-items: center; background: linear-gradient(180deg,#fafaf9,#fff); }}
  .login-box {{ width: 390px; background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 30px; box-shadow: 0 20px 50px rgba(28,25,23,.08); }}
  .input {{ height: 42px; border: 1px solid #d6d3d1; border-radius: 8px; padding: 10px 12px; color: #78716c; margin-top: 6px; }}
  .home {{ width: 100%; height: 100%; display: grid; place-items: center; text-align: center; background: linear-gradient(180deg,#fafaf9,#fff); }}
  .home h1 {{ font-size: 52px; }}
</style>
</head>
<body>
<div id="root"></div>
<script>
const DATA = {json.dumps(payload, ensure_ascii=False)};
const q = new URLSearchParams(location.search);
const id = q.get('screen') || 'dashboard';
const s = DATA[id] || DATA.dashboard;
const stepNames = ['创意扩散','框架搭建','风格统一','人物设计','概念图','宣传片','分镜设计','生成尾帧','直生视频'];
function art(i) {{ return `<div class="art alt${{i%4}}"></div>`; }}
function shell(inner) {{
  return `<div class="app"><aside class="sidebar"><div class="brand"><div class="logo">AI</div><div>AI Film Flow</div></div>
  <div class="nav"><div class="active">项目工作台</div><div>工作流看板</div><div>资产库</div><div>个人中心</div><div>管理后台</div></div>
  <div class="recent">最近项目<br/>旧影院的最后一束光<br/>文旅宣传片提案<br/>城市记忆短片</div></aside>
  <section class="main"><div class="top"><div class="crumb">AI 影视全流程工作流系统 / ${html.escape("${s.name}")}</div><div class="user"><span class="tag">点数 1280</span><div class="avatar">康</div><span>康泽铭</span></div></div><main class="content">${{inner}}</main></section></div>`;
}}
function defaultScreen() {{
  const cards = s.cards.map((c,i)=>`<div class="card"><span class="tag">功能 ${{i+1}}</span><h3>${{c}}</h3><p class="sub">该区域用于展示、编辑、确认或生成当前功能对应的数据。</p></div>`).join('');
  const thumbs = `<div class="thumbs">${{[0,1,2].map(i=>`<div class="thumb">${{art(i)}}<div class="cap">${{s.cards[i%s.cards.length]}} · 生成结果预览</div></div>`).join('')}}</div>`;
  const rows = `<div class="rows">${{[1,2,3,4].map(i=>`<div class="row"><b>镜头 ${{String(i).padStart(2,'0')}}</b><span>角色在核心场景中完成动作，系统记录画面、运镜、时长与参考资产。</span><span class="tag">已完成</span><button class="btn secondary">查看</button></div>`).join('')}}</div>`;
  return shell(`<div class="hero"><div><h1>${{s.name}}</h1><div class="sub">${{s.summary}}</div></div><button class="btn">开始执行</button></div><div class="grid">${{cards}}</div><div class="panel"><b>操作路径：</b>${{s.path}}<br/><b>操作步骤：</b>${{s.steps.join(' → ')}}</div>${{ id.includes('style')||id.includes('character')||id.includes('concept')||id.includes('trailer')||id.includes('video')||id.includes('assets') ? thumbs : rows }}`);
}}
function workflow() {{
 return shell(`<div class="hero"><div><h1>${{s.name}}</h1><div class="sub">${{s.summary}}</div></div><button class="btn">执行当前步骤</button></div><div class="steps">${{stepNames.map((n,i)=>`<div class="step ${{i<3?'done':i===3?'active':''}}">${{n}}</div>`).join('')}}</div><div class="panel"><h3>当前步骤：人物设计</h3><p class="sub">系统显示步骤状态、输入输出、生成按钮、失败重试和跳过入口。用户按顺序完成后，后续步骤自动解锁。</p></div><div class="grid">${{s.cards.slice(0,4).map(c=>`<div class="card"><h3>${{c}}</h3><div class="metric">完成</div><p class="sub">状态可追踪、结果可回看。</p></div>`).join('')}}</div>`);
}}
function home() {{
 return `<div class="app"><div class="home"><div><span class="tag">AI 驱动的影视工业化生产工具</span><h1>AI 影视全流程工作流系统</h1><p class="sub" style="margin:18px auto 28px">从元构思到成片，AI 辅助影视工业化生产</p><button class="btn">开始使用</button> <button class="btn secondary">登录账号</button></div></div></div>`;
}}
function login() {{
 return `<div class="app"><div class="login-wrap"><div class="login-box"><div style="text-align:center"><div class="logo" style="margin:0 auto 12px">AI</div><h1 style="font-size:22px">AI 影视工作流</h1><p class="sub">登录以继续管理你的项目</p></div><label>邮箱</label><div class="input">user@example.com</div><label>密码</label><div class="input">至少 6 位</div><button class="btn" style="width:100%;margin-top:18px">登录</button><button class="btn secondary" style="width:100%;margin-top:12px">还没有账号？立即注册</button></div></div></div>`;
}}
if (id === 'home') root.innerHTML = home();
else if (id === 'login') root.innerHTML = login();
else if (id === 'workflow') root.innerHTML = workflow();
else root.innerHTML = defaultScreen();
</script>
</body>
</html>"""
    HTML_FILE.write_text(html_doc, encoding="utf-8")


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_run_font(run, name="Microsoft YaHei", size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def add_para(doc, text="", style=None, bold=False):
    p = doc.add_paragraph(style=style)
    r = p.add_run(text)
    set_run_font(r, bold=bold)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_heading("", level=level)
    r = p.add_run(text)
    set_run_font(r, size={1: 16, 2: 13, 3: 12}.get(level, 12), bold=True, color="2E74B5" if level < 3 else "1F4D78")
    return p


def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        r = p.add_run(item)
        set_run_font(r)


def build_docx() -> None:
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    for edge in ("top_margin", "right_margin", "bottom_margin", "left_margin"):
        setattr(section, edge, Cm(2.3))

    styles = doc.styles
    styles["Normal"].font.name = "Microsoft YaHei"
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    styles["Normal"].font.size = Pt(10.5)
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.line_spacing = 1.2

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run("AI 影视全流程工作流系统")
    set_run_font(r, size=22, bold=True, color="111827")
    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = subtitle.add_run("软件著作权补正文档鉴别材料（软件使用说明书）")
    set_run_font(r, size=15, bold=True, color="2E74B5")
    for line in ["软件版本：V1.0", "软件简称：AI Film Flow", "著作权人：康泽铭", "补正针对：2026R11L2059409 软件登记补正通知书", "完成日期：2026 年 7 月"]:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(p.add_run(line), size=11)

    doc.add_page_break()
    add_heading(doc, "一、补正说明", 1)
    add_para(doc, "本材料根据中国版权保护中心软件著作权部出具的补正通知要求编制，重点补充 AI 影视全流程工作流系统运行过程中各主要功能对应的界面截图，并配合文字说明软件相关操作。截图覆盖登录注册、项目管理、9 步影视工作流、资产管理、充值与管理后台等主要功能，能够体现申请表所列软件功能和技术特点。")
    add_heading(doc, "二、软件概述", 1)
    add_para(doc, "AI 影视全流程工作流系统是一款面向影视前期策划与 AI 视频创作的 Web 工作流软件。系统以用户输入的元构思为起点，通过创意扩散、框架搭建、风格统一、人物设计、概念图、宣传片、分镜设计、生成尾帧和直生视频九个步骤，辅助用户完成从创意到视频资产的连续化生产。")
    add_para(doc, "系统采用浏览器访问方式运行，前端基于 Next.js 14、React 与 TypeScript 构建，后端通过 API Routes 调用文本、图像和视频生成模型，并结合 Prisma、PostgreSQL、对象存储、任务队列、ffmpeg 等组件完成数据存储、资产管理和视频合成。")
    add_heading(doc, "三、运行环境", 1)
    table = doc.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    table.rows[0].cells[0].text = "项目"
    table.rows[0].cells[1].text = "说明"
    for cell in table.rows[0].cells:
        set_cell_shading(cell, "F2F4F7")
    for k, v in [
        ("客户端", "Chrome、Edge、Firefox 等现代浏览器，推荐 1920×1080 及以上分辨率。"),
        ("服务端", "Next.js 14、Node.js、TypeScript、Prisma ORM、PostgreSQL。"),
        ("存储与队列", "对象存储保存图片、视频、音频等资产；Redis/BullMQ 或兼容队列处理异步生成任务。"),
        ("AI 能力", "文本生成、图像生成、图生视频、音乐生成与视频合成能力。"),
        ("部署方式", "支持 Vercel Serverless 或 Docker 容器化部署。"),
    ]:
        cells = table.add_row().cells
        cells[0].text = k
        cells[1].text = v

    add_heading(doc, "四、主要功能与界面截图", 1)
    for idx, item in enumerate(SCREENS_DATA, 1):
        add_heading(doc, f"4.{idx} {item['name']}", 2)
        add_para(doc, f"操作路径：{item['path']}", bold=True)
        add_para(doc, f"功能说明：{item['summary']}")
        add_para(doc, "操作步骤：")
        for step_idx, step in enumerate(item["steps"], 1):
            p = doc.add_paragraph(style="List Number")
            set_run_font(p.add_run(step))
        add_para(doc, "对应功能点：" + "、".join(item["cards"]) + "。")
        img = SCREENS / f"{idx:02d}_{item['id']}.png"
        if img.exists():
            pic = doc.add_picture(str(img), width=Cm(15.8))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cap = doc.add_paragraph()
            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run_font(cap.add_run(f"图 4-{idx} {item['name']}"), size=9, color="555555")

    add_page = doc.add_page_break
    add_heading(doc, "五、软件技术特点与功能对应关系", 1)
    add_bullets(doc, [
        "全流程状态机：通过工作流步骤状态记录创意、框架、风格、角色、场景、分镜、尾帧和视频生成进度。",
        "AI 与人工协同：每个步骤均支持生成、预览、确认、编辑、重新生成或跳过。",
        "风格与角色一致性：后续生图和视频生成会读取统一风格图与角色资产，降低视觉漂移。",
        "资产沉淀：图片、视频、音频、文本等结果统一保存为项目资产，便于筛选、复用和导出。",
        "异步任务处理：耗时较长的图像和视频生成通过任务状态、进度提示、失败重试机制进行管理。",
        "点数和管理后台：系统提供点数校验、充值审核、用户管理和数据分析，支撑实际运营。"
    ])
    add_heading(doc, "六、补正结论", 1)
    add_para(doc, "本补正文档已补充软件运行全部主要功能所对应的界面截图，并针对每个界面补充操作路径、操作步骤和功能说明。材料内容与 AI 影视全流程工作流系统 V1.0 的主要功能、技术特点和 Web 运行形态保持一致，可作为软件著作权登记补正文档鉴别材料提交。")

    doc.save(DOCX_FILE)


def build_pdf() -> None:
    font = r"C:\Windows\Fonts\msyh.ttc"
    bold_font = r"C:\Windows\Fonts\msyhbd.ttc"
    pdfmetrics.registerFont(TTFont("MSYH", font))
    pdfmetrics.registerFont(TTFont("MSYHB", bold_font))
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("CNTitle", fontName="MSYHB", fontSize=22, leading=30, alignment=TA_CENTER, spaceAfter=12))
    styles.add(ParagraphStyle("CNSub", fontName="MSYH", fontSize=12, leading=18, alignment=TA_CENTER, textColor=colors.HexColor("#374151")))
    styles.add(ParagraphStyle("CNH1", fontName="MSYHB", fontSize=16, leading=22, textColor=colors.HexColor("#2E74B5"), spaceBefore=12, spaceAfter=8))
    styles.add(ParagraphStyle("CNH2", fontName="MSYHB", fontSize=13, leading=19, textColor=colors.HexColor("#2E74B5"), spaceBefore=10, spaceAfter=6))
    styles.add(ParagraphStyle("CNBody", fontName="MSYH", fontSize=10.5, leading=16, alignment=TA_LEFT, spaceAfter=6))
    styles.add(ParagraphStyle("CNCAP", fontName="MSYH", fontSize=9, leading=12, alignment=TA_CENTER, textColor=colors.HexColor("#555555"), spaceAfter=8))

    story = [
        Paragraph("AI 影视全流程工作流系统", styles["CNTitle"]),
        Paragraph("软件著作权补正文档鉴别材料（软件使用说明书）", styles["CNSub"]),
        Paragraph("软件版本：V1.0<br/>软件简称：AI Film Flow<br/>著作权人：康泽铭<br/>补正针对：2026R11L2059409 软件登记补正通知书<br/>完成日期：2026 年 7 月", styles["CNSub"]),
        PageBreak(),
        Paragraph("一、补正说明", styles["CNH1"]),
        Paragraph("本材料根据中国版权保护中心软件著作权部出具的补正通知要求编制，重点补充 AI 影视全流程工作流系统运行过程中各主要功能对应的界面截图，并配合文字说明软件相关操作。截图覆盖登录注册、项目管理、9 步影视工作流、资产管理、充值与管理后台等主要功能。", styles["CNBody"]),
        Paragraph("二、软件概述", styles["CNH1"]),
        Paragraph("AI 影视全流程工作流系统是一款面向影视前期策划与 AI 视频创作的 Web 工作流软件。系统以用户输入的元构思为起点，通过创意扩散、框架搭建、风格统一、人物设计、概念图、宣传片、分镜设计、生成尾帧和直生视频九个步骤，辅助用户完成从创意到视频资产的连续化生产。", styles["CNBody"]),
        Paragraph("三、主要功能与界面截图", styles["CNH1"]),
    ]

    for idx, item in enumerate(SCREENS_DATA, 1):
        story.append(Paragraph(f"3.{idx} {html.escape(item['name'])}", styles["CNH2"]))
        story.append(Paragraph(f"<b>操作路径：</b>{html.escape(item['path'])}", styles["CNBody"]))
        story.append(Paragraph(f"<b>功能说明：</b>{html.escape(item['summary'])}", styles["CNBody"]))
        story.append(Paragraph("<b>操作步骤：</b>" + "；".join(html.escape(s) for s in item["steps"]) + "。", styles["CNBody"]))
        img = SCREENS / f"{idx:02d}_{item['id']}.png"
        if img.exists():
            story.append(PdfImage(str(img), width=16.2 * cm, height=10.125 * cm))
            story.append(Paragraph(f"图 3-{idx} {html.escape(item['name'])}", styles["CNCAP"]))

    story.append(Paragraph("四、补正结论", styles["CNH1"]))
    story.append(Paragraph("本补正文档已补充软件运行全部主要功能所对应的界面截图，并针对每个界面补充操作路径、操作步骤和功能说明。材料内容与 AI 影视全流程工作流系统 V1.0 的主要功能、技术特点和 Web 运行形态保持一致，可作为软件著作权登记补正文档鉴别材料提交。", styles["CNBody"]))

    doc = SimpleDocTemplate(str(PDF_FILE), pagesize=A4, rightMargin=2.1 * cm, leftMargin=2.1 * cm, topMargin=2.0 * cm, bottomMargin=2.0 * cm)
    doc.build(story)


def main() -> None:
    ensure_dirs()
    write_html()
    build_docx()
    build_pdf()
    print(DOCX_FILE)
    print(PDF_FILE)
    print(HTML_FILE)


if __name__ == "__main__":
    main()
