from __future__ import annotations

import csv
import hashlib
import json
import shutil
import subprocess
import zipfile
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "source-code-copyright"
DELIVERABLES = BASE / "Deliverables"
PRIVATE = BASE / "PrivateDeliverables"
EVIDENCE = BASE / "Evidence" / "screenshots"
SCREEN_SOURCE = ROOT / "output" / "copyright-material" / "edge-wide-sanitized"
UNIVERSAL_PRIVATE = ROOT.parent / "fb862" / "Docs" / "SoftwareCopyright" / "PrivateDeliverables"

SOFTWARE_NAME = "AI 影视全流程工作流系统"
SHORT_NAME = "AI Film Flow"
VERSION = "V1.0"
PACKAGE_VERSION = "1.0.0"
COMPLETION_DATE = "2026年6月7日"
LINES_PER_PAGE = 50

SOURCE_DOCX = DELIVERABLES / "01_源程序鉴别材料.docx"
MANUAL_DOCX = DELIVERABLES / "02_软件操作说明书.docx"
ARCHIVE_ZIP = DELIVERABLES / "03_源代码归档.zip"
INFO_DOCX = PRIVATE / "04_软著信息采集表_完整版.docx"
APPLICATION_DOCX = PRIVATE / "05_计算机软件著作权客户登记申请表_完整版.docx"

MAIN_FUNCTIONS = (
    "本软件面向影视前期策划与生成式视频创作，将创意、故事结构、视觉资产和视频片段组织在同一Web工作流中。"
    "用户登录后可创建项目并输入元构思，系统在创意扩散步骤生成多个创作方向，支持选择方向、继续深化和保存迭代结果。"
    "框架搭建步骤把选定方向整理为故事梗概、角色、环境、幕结构和视觉基调，用户可以逐项编辑，也可导入已有框架文件。"
    "风格统一步骤依据故事信息生成视觉方案和样图，用户确认其中一组后，系统把该结果作为后续人物图、概念图和关键帧生成的统一参考。"
    "人物设计步骤按角色设定生成角色图并管理角色参考；概念图步骤按幕和场景生成画面，用于验证叙事空间、色彩和构图。"
    "宣传片步骤读取概念图和故事信息，逐段生成视频提示与视频片段，记录各片段状态；片段完成后通过FFmpeg裁剪、拼接，并将生成或回退的背景音乐裁剪后与画面合成。"
    "分镜设计步骤把故事拆分为镜头序列，提供表格和画布视图，支持编辑镜头描述、景别、运镜、时长、角色和参考图，支持拖拽排序以及JSON、Excel导入导出。"
    "生成尾帧步骤读取分镜首帧、统一风格和镜头描述，为各镜头生成尾帧并回写分镜数据。"
    "直生视频步骤以首帧或首尾帧为输入建立异步任务，生成或合成镜头视频，并在全部片段完成后形成连续视频成果。"
    "系统还提供项目资产库，对图片、视频、音频、文本和参考素材进行分类预览与下载；提供用户资产复用、项目小组、邀请与贡献记录；"
    "提供点数余额、充值申请和记录查询，并在管理后台提供用户、充值、操作结果、供应商请求及费用统计。"
    "各生成步骤通过状态字段、任务队列和结果记录保存处理中、完成、失败和取消状态，支持失败重试及页面恢复，避免重复操作造成结果丢失。"
)

TECH_FEATURES = (
    "采用Next.js、React、TypeScript、PostgreSQL/Prisma、Redis/BullMQ、R2与FFmpeg，"
    "以九步状态工作流串联文本、图像、视频和音频资产，注入风格参考。"
)

SCREEN_SECTIONS = [
    ("系统首页", "00_home.png", "浏览器访问系统首页", "首页展示软件全称、用途说明和登录入口。", ["输入系统访问地址。", "确认页面显示“AI 影视全流程工作流系统”。", "点击开始使用或登录进入系统。"]),
    ("登录界面", "00_login.png", "首页 → 登录", "登录页用于校验用户身份并隔离项目和资产。", ["输入已注册账号信息。", "提交登录。", "验证通过后进入仪表盘。"]),
    ("项目仪表盘", "01_dashboard.png", "登录 → 仪表盘", "仪表盘展示项目列表、进度和最近更新时间。", ["查看已有项目卡片。", "点击项目进入总览。", "也可从侧栏创建新项目。"]),
    ("项目总览", "02_project_overview.png", "仪表盘 → 选择项目", "项目总览集中显示项目信息、完成进度和工作流入口。", ["选择目标项目。", "核对项目标题和进度。", "进入工作流或资产库。"]),
    ("项目资产库", "03_assets.png", "项目 → 资产库", "资产库按类型管理项目生成的图片、视频、音频、文本和参考素材。", ["打开资产库。", "按类型筛选成果。", "预览或下载所需资产。"]),
    ("分镜编辑器", "04_storyboard_editor.png", "项目 → 分镜设计", "分镜编辑器支持镜头字段编辑、排序、画面查看及结构化导出。", ["选择表格或画布视图。", "编辑镜头描述、运镜和时长。", "拖拽排序并导出JSON或Excel。"]),
    ("充值与记录", "05_recharge.png", "设置 → 充值", "充值页面展示点数余额、申请入口和历史记录。", ["输入充值信息。", "上传真实凭证。", "提交后等待管理员审核。"]),
    ("管理后台", "06_admin_users.png", "管理员入口 → 用户统计", "管理后台用于查看用户、点数和运营数据。", ["以管理员身份进入后台。", "查看用户和统计信息。", "按权限执行审核或点数管理。"]),
    ("九步工作流总览", "07_workflow_overview.png", "项目总览 → 工作流", "工作流看板按九个可见步骤组织项目，显示当前步骤和完成状态。", ["进入工作流看板。", "核对九步状态。", "点击已解锁步骤查看内容。"]),
    ("创意扩散", "08_ideation.png", "工作流 → 创意扩散", "系统基于元构思生成候选创意方向，并保存用户选择。", ["输入或确认元构思。", "执行创意扩散。", "选择方向或继续深化。"]),
    ("框架搭建", "09_framework.png", "工作流 → 框架搭建", "框架步骤组织梗概、角色、环境、幕结构和视觉基调。", ["执行框架生成。", "检查结构化内容。", "按需编辑或深化字段。"]),
    ("风格统一", "10_style.png", "工作流 → 风格统一", "风格步骤生成视觉方案和样图，选定结果作为后续统一参考。", ["生成风格方案。", "预览样图。", "选择一组作为风格基准。"]),
    ("人物设计", "11_character.png", "工作流 → 人物设计", "人物设计依据框架角色和风格参考生成角色资产。", ["核对角色列表。", "生成角色图。", "必要时调整提示并重新生成。"]),
    ("概念图", "12_concept.png", "工作流 → 概念图", "概念图按幕和场景生成关键画面，验证整体视觉方向。", ["进入概念图步骤。", "按场景生成画面。", "确认或重新生成单张结果。"]),
    ("宣传片", "13_trailer.png", "工作流 → 宣传片", "宣传片步骤逐段生成视频，并在片段完成后拼接和混合背景音乐。", ["生成视频提示和片段。", "检查各片段状态。", "片段齐备后执行合成。"]),
    ("分镜步骤", "14_storyboard_step.png", "工作流 → 分镜设计", "分镜步骤把故事转换为镜头序列，并连接尾帧与视频步骤。", ["选择分镜模式。", "生成或导入镜头。", "进入分镜编辑器调整。"]),
    ("生成尾帧", "15_keyframes.png", "工作流 → 生成尾帧", "系统读取分镜首帧和统一风格，生成镜头尾帧并回写结果。", ["检查首帧输入。", "逐镜头或批量生成尾帧。", "确认结果状态。"]),
    ("直生视频", "16_direct_video.png", "工作流 → 直生视频", "直生视频以首帧或首尾帧建立视频任务并汇总镜头成果。", ["选择视频模型和输入。", "批量提交镜头任务。", "完成后预览并合成。"]),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def set_run(run, name="宋体", size=10.5, bold=False, color=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def add_field(run, code: str):
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = code
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, end])


def configure_doc(doc: Document, header_title: str, page_in_header=True):
    sec = doc.sections[0]
    sec.page_height = Cm(29.7)
    sec.page_width = Cm(21)
    sec.top_margin = Cm(1.7)
    sec.bottom_margin = Cm(1.5)
    sec.left_margin = Cm(1.7)
    sec.right_margin = Cm(1.7)
    p = sec.header.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    if page_in_header:
        p.paragraph_format.tab_stops.add_tab_stop(Cm(17.2))
        r = p.add_run(header_title)
        set_run(r, size=9)
        r = p.add_run("\t")
        set_run(r, size=9)
        r = p.add_run()
        add_field(r, "PAGE")
        set_run(r, size=9)
    else:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(header_title)
        set_run(r, size=9)
    sec.footer.paragraphs[0].clear()


def product_code_files() -> list[Path]:
    exts = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".css", ".prisma", ".sql"}
    roots = [ROOT / x for x in ["app", "components", "lib", "hooks", "types"]]
    files = [p for r in roots for p in r.rglob("*") if p.is_file() and p.suffix.lower() in exts]
    extras = [
        ROOT / "middleware.ts", ROOT / "next.config.mjs", ROOT / "postcss.config.mjs",
        ROOT / "prisma.config.ts", ROOT / "tailwind.config.ts", ROOT / "prisma" / "schema.prisma",
    ]
    files += [p for p in extras if p.exists()]
    files += [p for p in (ROOT / "prisma" / "migrations").rglob("*.sql")]
    priority = {"package.json": 0, "app/layout.tsx": 1, "app/page.tsx": 2}
    return sorted(set(files), key=lambda p: (priority.get(p.relative_to(ROOT).as_posix(), 100), p.relative_to(ROOT).as_posix()))


def archive_files() -> list[Path]:
    files = product_code_files()
    for p in [ROOT / "package.json", ROOT / "package-lock.json", ROOT / "tsconfig.json", ROOT / "Dockerfile", ROOT / "docker-compose.yml", ROOT / "docker-compose.dev.yml", ROOT / "vercel.json"]:
        if p.exists(): files.append(p)
    files += [p for p in (ROOT / "prompts").rglob("*") if p.is_file()]
    return sorted(set(files), key=lambda p: p.relative_to(ROOT).as_posix())


def display_width(text: str) -> int:
    return sum(2 if ord(c) > 127 else 1 for c in text.expandtabs(4))


def wrap_code(text: str, limit=58) -> list[str]:
    text = text.expandtabs(4).rstrip("\r\n")
    if not text: return [""]
    out, buf, width = [], "", 0
    for ch in text:
        w = 2 if ord(ch) > 127 else 1
        if width + w > limit and buf:
            out.append(buf)
            buf, width = "    " + ch, 4 + w
        else:
            buf += ch
            width += w
    if buf: out.append(buf)
    return out


def source_listing(files: list[Path]):
    lines = []
    origins = []
    physical = 0
    for path in files:
        rel = path.relative_to(ROOT).as_posix()
        raw = path.read_text(encoding="utf-8", errors="replace").splitlines()
        physical += len(raw)
        for line in [f"/* ===== FILE: {rel} ===== */", *raw]:
            for wrapped in wrap_code(line):
                lines.append(wrapped)
                origins.append(rel)
    if len(lines) < 3000:
        raise RuntimeError(f"源代码不足3000版面行：{len(lines)}")
    selected = lines[:1500] + lines[-1500:]
    selected_origins = origins[:1500] + origins[-1500:]
    return selected, selected_origins, physical, len(lines)


def build_source_docx(selected: list[str], layout_lines: int):
    doc = Document()
    configure_doc(doc, f"{SOFTWARE_NAME} {VERSION} 源程序鉴别材料（前30页及后30页）", page_in_header=True)
    sec = doc.sections[0]
    sec.top_margin = Cm(1.55)
    sec.bottom_margin = Cm(1.2)
    sec.left_margin = Cm(1.45)
    sec.right_margin = Cm(1.45)
    normal = doc.styles["Normal"]
    normal.font.name = "Consolas"
    normal.font.size = Pt(6.8)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    for page in range(60):
        block = selected[page * LINES_PER_PAGE:(page + 1) * LINES_PER_PAGE]
        table = doc.add_table(rows=LINES_PER_PAGE, cols=2)
        table.autofit = False
        table.columns[0].width = Cm(1.05)
        table.columns[1].width = Cm(16.8)
        corpus_start = page * LINES_PER_PAGE + 1 if page < 30 else layout_lines - 1500 + (page - 30) * LINES_PER_PAGE + 1
        for i, (row, code) in enumerate(zip(table.rows, block), 1):
            row.height = Pt(12.5)
            row.height_rule = 2
            for cell in row.cells:
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                tcPr = cell._tc.get_or_add_tcPr()
                tcMar = OxmlElement("w:tcMar")
                for side in ("top", "left", "bottom", "right"):
                    el = OxmlElement(f"w:{side}")
                    el.set(qn("w:w"), "0")
                    el.set(qn("w:type"), "dxa")
                    tcMar.append(el)
                tcPr.append(tcMar)
            p0 = row.cells[0].paragraphs[0]
            p0.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            p0.paragraph_format.space_after = Pt(0)
            r0 = p0.add_run(str(corpus_start + i - 1))
            set_run(r0, "Consolas", 7.2, color="666666")
            p1 = row.cells[1].paragraphs[0]
            p1.paragraph_format.space_after = Pt(0)
            r1 = p1.add_run(code)
            set_run(r1, "Consolas", 7.2)
        if page < 59: doc.add_page_break()
    SOURCE_DOCX.parent.mkdir(parents=True, exist_ok=True)
    doc.save(SOURCE_DOCX)


def add_title(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run(text)
    set_run(r, "黑体", 16 if level == 1 else 13, True)
    return p


def add_body(doc, text, indent=True):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing = 1.45
    p.paragraph_format.space_after = Pt(5)
    if indent: p.paragraph_format.first_line_indent = Cm(0.74)
    r = p.add_run(text)
    set_run(r, "宋体", 10.5)
    return p


def manual_page(doc, title, image_name, path_text, desc, steps):
    doc.add_page_break()
    add_title(doc, title)
    add_body(doc, f"操作路径：{path_text}", indent=False)
    add_body(doc, desc)
    image = EVIDENCE / image_name
    if not image.exists(): raise FileNotFoundError(image)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(image), width=Cm(16.9))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(cap.add_run(f"图：{title}实际运行界面（个人信息已脱敏）"), "宋体", 9)
    add_body(doc, "操作步骤：", indent=False)
    for i, step in enumerate(steps, 1): add_body(doc, f"{i}. {step}", indent=False)


def build_manual_docx():
    doc = Document()
    configure_doc(doc, f"{SOFTWARE_NAME} 软件操作说明书 {VERSION}", page_in_header=True)
    for _ in range(6): doc.add_paragraph()
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(SOFTWARE_NAME), "黑体", 22, True)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run("软件操作说明书"), "黑体", 18, True)
    for text in [f"软件简称：{SHORT_NAME}", f"版本号：{VERSION}", "文档类型：软件著作权文档鉴别材料", f"完成日期：{COMPLETION_DATE}"]:
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run(p.add_run(text), "宋体", 13)

    doc.add_page_break(); add_title(doc, "目录")
    toc = ["第一章 软件概述", "第二章 运行环境与登录", "第三章 九步工作流操作", "第四章 资产、分镜与运营管理", "第五章 状态恢复与常见问题", "附录 界面证据说明"]
    for i, text in enumerate(toc, 1): add_body(doc, f"{i}. {text}", indent=False)

    doc.add_page_break(); add_title(doc, "第一章 软件概述")
    add_body(doc, f"{SOFTWARE_NAME}是一套面向影视前期策划和生成式视频创作的Web软件。系统以项目为单位保存创意、故事框架、视觉参考、角色、场景、分镜、关键帧、视频和音频，并用九个可见步骤组织从元构思到视频成果的操作过程。")
    add_title(doc, "1.1 主要功能", 2); add_body(doc, MAIN_FUNCTIONS)
    add_title(doc, "1.2 技术结构", 2); add_body(doc, TECH_FEATURES)
    add_title(doc, "1.3 软件边界", 2); add_body(doc, "本说明书仅描述当前仓库和实际界面中已经实现的功能。评测优化、AI渲染和电脑运镜等预留类型不列为当前九步主流程；外部模型的可用性、生成时间和结果质量取决于已配置的供应商服务。")

    doc.add_page_break(); add_title(doc, "第二章 运行环境与基本操作")
    add_title(doc, "2.1 运行环境", 2)
    add_body(doc, "客户端使用现代Web浏览器，推荐1920×1080或更高分辨率；服务端使用Node.js 24、PostgreSQL、Redis、Cloudflare R2及FFmpeg。开发基线为Next.js 15.5、React 19和TypeScript。")
    add_title(doc, "2.2 基本操作", 2)
    for text in ["登录后从仪表盘创建或打开项目。", "在项目总览进入工作流，按步骤确认输入、执行生成并检查状态。", "生成任务进行中时保留页面状态；失败时根据错误信息重试或取消。", "在资产库统一预览和下载项目成果。"]: add_body(doc, text, indent=False)
    add_title(doc, "2.3 状态说明", 2)
    add_body(doc, "步骤状态包括待开始、处理中、已完成、失败和已取消。后续步骤通常依赖前一步输出；重新生成会形成新的操作记录，界面根据服务端状态恢复进度。")

    for section in SCREEN_SECTIONS:
        manual_page(doc, *section)

    doc.add_page_break(); add_title(doc, "第五章 常见问题与故障处理")
    faqs = [
        ("任务长时间处理中", "先刷新页面确认服务端状态；仍无变化时使用取消或重试，并检查队列、模型供应商和点数余额。"),
        ("图片或视频无法显示", "检查网络与对象存储链接是否有效；从资产库重新打开，必要时重新生成对应资产。"),
        ("后续步骤未解锁", "确认前置步骤已完成或按产品允许方式标记跳过；检查当前项目的步骤状态。"),
        ("分镜顺序不正确", "在分镜编辑器拖拽排序并保存，再重新打开页面核对顺序；导出前确认镜头编号和时长。"),
        ("合成失败", "确认所有必需片段均已完成且媒体可下载，检查FFmpeg运行环境和临时目录，再执行合成。"),
    ]
    for q, a in faqs:
        add_title(doc, q, 2); add_body(doc, a)
    add_title(doc, "提交材料说明", 2)
    add_body(doc, "本说明书中的截图来自软件实际运行界面。为保护账号、项目和运营数据，仅对识别性信息做遮盖或替换，不改变界面布局和功能含义。")
    MANUAL_DOCX.parent.mkdir(parents=True, exist_ok=True)
    doc.save(MANUAL_DOCX)


def replace_cell(cell, text):
    cell.text = text
    for p in cell.paragraphs:
        p.paragraph_format.space_after = Pt(0)
        for r in p.runs: set_run(r, "宋体", 9)


def add_form_table(doc, rows, widths=(4.2, 12.3)):
    table = doc.add_table(rows=0, cols=2)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].width, cells[1].width = Cm(widths[0]), Cm(widths[1])
        replace_cell(cells[0], label)
        replace_cell(cells[1], value)
        for r in cells[0].paragraphs[0].runs: r.bold = True
    return table


def build_private_forms(code_lines: int):
    src_info = UNIVERSAL_PRIVATE / "04_软著信息采集表_完整版.docx"
    src_app = UNIVERSAL_PRIVATE / "计算机软件著作权客户登记申请表.docx"
    if not src_info.exists() or not src_app.exists():
        raise FileNotFoundError("未找到Universal NPR私有表格模板")
    PRIVATE.mkdir(parents=True, exist_ok=True)

    source_info = Document(src_info)
    source_app = Document(src_app)
    old_info = source_info.tables[0]
    old_app = source_app.tables[0]
    owner = old_app.rows[27].cells[1].text.strip()
    owner_category = old_app.rows[28].cells[1].text.strip()
    nationality = old_app.rows[29].cells[1].text.strip()
    province = old_app.rows[29].cells[3].text.strip()
    city = old_app.rows[29].cells[5].text.strip()
    cert_type = old_app.rows[30].cells[1].text.strip()
    cert_no = old_app.rows[31].cells[1].text.strip()
    phone = old_info.rows[8].cells[4].text.strip()
    address = old_info.rows[9].cells[4].text.strip()

    d = Document()
    configure_doc(d, f"软件名称：{SOFTWARE_NAME}  {VERSION}", page_in_header=False)
    sec = d.sections[0]
    sec.top_margin = Cm(1.8); sec.bottom_margin = Cm(1.8); sec.left_margin = Cm(2); sec.right_margin = Cm(2)
    p = d.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run("软件著作权信息采集表"), "黑体", 18, True)
    add_title(d, "一、软件基本信息", 2)
    add_form_table(d, [
        ("软件全称", SOFTWARE_NAME), ("软件简称", SHORT_NAME), ("版本号", VERSION),
        ("软件分类", "应用软件"), ("软件作品说明", "原创"), ("开发完成日期", COMPLETION_DATE),
        ("发表状态", "未发表"), ("开发方式", "独立开发"), ("权利取得方式", "原始取得"), ("权利范围", "全部"),
    ])
    add_title(d, "二、著作权人信息", 2)
    add_form_table(d, [
        ("姓名/单位名称", owner), ("类别", owner_category), ("国籍", nationality),
        ("省份/城市", f"{province} / {city}"), ("证件类型", cert_type), ("证件号码", cert_no),
        ("联系电话", phone), ("详细地址", address),
    ])
    d.add_page_break()
    add_title(d, "三、软件技术信息")
    add_form_table(d, [
        ("开发的硬件环境（≤50字）", "x86-64开发计算机，16GB内存，512GB固态硬盘"),
        ("运行的硬件环境（≤50字）", "x86-64服务器或云主机，4核CPU、8GB内存"),
        ("开发操作系统（≤50字）", "Windows 11 64位"),
        ("开发环境/开发工具（≤50字）", "VS Code、Node.js 24、npm、Git、Prisma CLI、Docker"),
        ("运行平台/操作系统（≤50字）", "Linux服务器或Vercel Serverless，现代Web浏览器"),
        ("运行支撑环境/支持软件（≤50字）", "Node.js 24、PostgreSQL、Redis、Cloudflare R2、FFmpeg"),
        ("编程语言", "TypeScript、TSX、JavaScript、CSS、Prisma Schema、SQL"),
        ("源程序量", f"{code_lines}行"),
        ("开发目的（8—50字）", "统一影视前期创意、视觉资产、分镜与视频生成流程，提高项目组织和制作效率。"),
        ("面向领域/行业（4—50字）", "影视制作、广告创意、短视频、数字内容与文化传媒"),
    ])
    d.add_page_break()
    add_title(d, "四、软件的主要功能（500—1300字）")
    add_body(d, MAIN_FUNCTIONS)
    add_title(d, "五、软件的技术特点（不超过100字）")
    add_body(d, TECH_FEATURES)
    add_body(d, "申请人确认：以上技术信息依据当前代码、运行界面和依赖清单整理；身份、权属、完成日期及发表状态应在提交前由申请人复核。", indent=False)
    d.save(INFO_DOCX)

    shutil.copy2(src_app, APPLICATION_DOCX)
    d = Document(APPLICATION_DOCX)
    for sec in d.sections:
        sec.header.paragraphs[0].clear()
        sec.footer.paragraphs[0].clear()
    t = d.tables[0]
    values = {
        1: SOFTWARE_NAME, 2: SHORT_NAME, 3: "●应用软件  ○嵌入式软件  ○中间件  ○操作系统",
        4: VERSION, 5: "●原创  ○修改（含翻译软件、合成软件）", 6: COMPLETION_DATE,
        7: "○已发表  ●未发表", 8: "不适用（未发表）", 9: "不适用（未发表）",
        10: "●独立开发  ○合作开发  ○委托开发  ○下达任务开发",
        11: "●原始取得  ○继受取得；软件未登记，未做变更或补充。", 12: "●全部  ○部分",
        14: "x86-64开发计算机，16GB内存，512GB固态硬盘",
        15: "x86-64服务器或云主机，4核CPU、8GB内存", 16: "Windows 11 64位",
        17: "VS Code、Node.js 24、npm、Git、Prisma CLI、Docker",
        18: "Linux服务器或Vercel Serverless，现代Web浏览器",
        19: "Node.js 24、PostgreSQL、Redis、Cloudflare R2、FFmpeg",
        20: "TypeScript、TSX、JavaScript、CSS、Prisma Schema、SQL", 21: f"{code_lines}行",
        22: "统一影视前期创意、视觉资产、分镜与视频生成流程，提高项目组织和制作效率。",
        23: "影视制作、广告创意、短视频、数字内容与文化传媒",
        24: MAIN_FUNCTIONS, 25: TECH_FEATURES,
    }
    for row, value in values.items(): replace_cell(t.rows[row].cells[1], value)
    d.save(APPLICATION_DOCX)


def build_archive_and_manifests(files: list[Path], code_lines: int, layout_lines: int, selected_origins: list[str]):
    rows = []
    for src in files:
        rel = src.relative_to(ROOT)
        rows.append({"path": rel.as_posix(), "bytes": src.stat().st_size, "sha256": sha256(src)})
    with zipfile.ZipFile(ARCHIVE_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for item in rows: z.write(ROOT / item["path"], item["path"])
    with (BASE / "05_源代码文件与哈希清单.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["path", "bytes", "sha256"]); w.writeheader(); w.writerows(rows)
    selection = {
        "software": SOFTWARE_NAME, "version": VERSION, "gitCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "productSourceFiles": len(product_code_files()), "sourcePhysicalLines": code_lines, "layoutLines": layout_lines,
        "listingPages": 60, "linesPerPage": 50, "frontStart": selected_origins[0], "frontEnd": selected_origins[1499],
        "backStart": selected_origins[1500], "backEnd": selected_origins[-1],
        "frontLayoutRange": [1, 1500], "backLayoutRange": [layout_lines - 1499, layout_lines],
    }
    (BASE / "SOURCE_LISTING_SELECTION.json").write_text(json.dumps(selection, ensure_ascii=False, indent=2), encoding="utf-8")


def copy_evidence():
    if not SCREEN_SOURCE.exists(): raise FileNotFoundError(SCREEN_SOURCE)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for _, name, *_ in SCREEN_SECTIONS: shutil.copy2(SCREEN_SOURCE / name, EVIDENCE / name)


def write_readmes(code_files, code_lines, layout_lines):
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    readme = f"""# {SOFTWARE_NAME} {VERSION} 软件著作权材料

本目录是按当前代码与真实运行界面重建的材料包。软件全称、简称和版本已统一；旧的两份TXT仅作为历史材料保留，不再作为本次提交版。

## 可提交材料

- `Deliverables/01_源程序鉴别材料.docx`：60页，每页50行，选取完整排版语料第1-1500行及第{layout_lines - 1499}-{layout_lines}行；页码位于页眉右侧。
- `Deliverables/01_源程序鉴别材料.pdf`：由上述Word稿导出的提交预览版。
- `Deliverables/02_软件操作说明书.docx`：包含软件实际运行界面、操作路径和文字说明，超过15页。
- `Deliverables/02_软件操作说明书.pdf`：由上述Word稿导出的提交预览版。
- `Deliverables/03_源代码归档.zip`：保留源码目录结构的完整归档。
- `PrivateDeliverables/04_软著信息采集表_完整版.docx`：含技术字段和申请人信息，仅限本机使用。
- `PrivateDeliverables/05_计算机软件著作权客户登记申请表_完整版.docx`：已填写技术内容并保留申请人字段，仅限本机使用。
- `05_源代码文件与哈希清单.csv`、`SOURCE_LISTING_SELECTION.json`：归档与源程序选段证据。

## 基线

- 对应Git提交：`{commit}`
- 产品源码：{code_files}个文件，{code_lines}行
- 软件包版本：`{PACKAGE_VERSION}`；申报版本：`{VERSION}`
- 验证：`npm test` 45项通过；`npm run build`通过

## 提交前人工确认

- 申请人姓名、证件号码、地址、电话等个人信息是否与证件及在线申请一致。
- 完成日期、发表状态、开发方式、权利取得方式是否与事实一致。
- 在线申请中的软件全称必须逐字使用“{SOFTWARE_NAME}”，版本号使用“{VERSION}”。
- 若登记机构要求PDF，可从两份Word提交稿另存为PDF，并再次核对页数、页眉和截图清晰度。
"""
    (BASE / "README.md").write_text(readme, encoding="utf-8")
    audit = f"""# 软件著作权材料审查记录

## 已修复的硬伤

1. 旧源码材料名称为“FilmFlow 影视工作流系统”，与申请口径“{SOFTWARE_NAME}”不一致；新材料已统一。
2. 旧源码只有两份TXT且共2977行，并标注“目标3000行”；新Word固定60页×50行，明确选取完整排版语料第1-1500行及第{layout_lines - 1499}-{layout_lines}行。
3. 旧脚本把页码放在页脚并拆成前后两份；新稿合并为一个文档，页码位于页眉右侧，无宣传性页脚。
4. 旧说明书使用Next.js 14等过时描述；新稿按仓库实际依赖更新为Next.js 15.5、React 19和Node.js 24。
5. 旧说明书部分版本只有文字占位或非实际界面；新稿仅使用已保存的真实运行截图，个人信息采用遮盖/替换处理。
6. 旧信息表源程序量为选段数量；新稿按主要产品源码口径填写为{code_lines}行，并提供逐文件哈希清单。
7. 当前实际主流程为九个可见步骤；预留的评测优化、AI渲染和电脑运镜未作为已完成主功能申报。

## 仍需申请人核对

- 私有表格中的身份、地址、电话等内容由既有Universal NPR表格保留，必须由申请人逐项复核。
- 完成日期暂按既有FilmFlow说明书记录“{COMPLETION_DATE}”填写；若在线申请已使用其他日期，应以已申报事实统一修改。
- 本材料只能证明软件实现与文档一致，不能替代登记机构或代理人的形式审查。
"""
    (BASE / "04_材料清单与填报说明.md").write_text(audit, encoding="utf-8")


def package_manifest():
    outputs = [SOURCE_DOCX, MANUAL_DOCX, ARCHIVE_ZIP, INFO_DOCX, APPLICATION_DOCX, BASE / "05_源代码文件与哈希清单.csv", BASE / "SOURCE_LISTING_SELECTION.json"]
    for pdf in [DELIVERABLES / "01_源程序鉴别材料.pdf", DELIVERABLES / "02_软件操作说明书.pdf"]:
        if pdf.exists(): outputs.append(pdf)
    data = {"generated": str(date.today()), "software": SOFTWARE_NAME, "version": VERSION, "files": []}
    for p in outputs: data["files"].append({"path": p.relative_to(BASE).as_posix(), "bytes": p.stat().st_size, "sha256": sha256(p)})
    (BASE / "PACKAGE_MANIFEST.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    DELIVERABLES.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    copy_evidence()
    code = product_code_files()
    selected, origins, physical, layout = source_listing(code)
    build_source_docx(selected, layout)
    build_manual_docx()
    build_private_forms(physical)
    build_archive_and_manifests(archive_files(), physical, layout, origins)
    write_readmes(len(code), physical, layout)
    package_manifest()
    print(json.dumps({"sourceFiles": len(code), "sourceLines": physical, "sourceDocx": str(SOURCE_DOCX), "manualDocx": str(MANUAL_DOCX)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
