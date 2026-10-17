from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

OUT=Path(r'D:\.pogget\user_storage\u_461180\b9b8b\docs\PatentSubstantiveExam\主动修改准备包_2026-10-17')
pdfmetrics.registerFont(TTFont('SimSun',r'C:\Windows\Fonts\simsun.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('SimHei',r'C:\Windows\Fonts\simhei.ttf'))
styles=getSampleStyleSheet()
body=ParagraphStyle('cnbody',fontName='SimSun',fontSize=10.5,leading=17,alignment=TA_JUSTIFY,wordWrap='CJK',spaceAfter=5)
small=ParagraphStyle('cnsmall',parent=body,fontSize=9,leading=14)
title=ParagraphStyle('cntitle',fontName='SimHei',fontSize=16,leading=22,alignment=TA_CENTER,spaceAfter=8)
subtitle=ParagraphStyle('cnsubtitle',fontName='SimHei',fontSize=11,leading=18,alignment=TA_CENTER,spaceAfter=12)
h1=ParagraphStyle('cnh1',fontName='SimHei',fontSize=12,leading=19,spaceBefore=7,spaceAfter=5)
cell=ParagraphStyle('cell',parent=small,alignment=TA_LEFT)
center=ParagraphStyle('center',parent=small,alignment=TA_CENTER)

summary={1:'整理S3幕结构限定；增加视频总时长计算；明确备用AI音乐模型与静音音轨。',2:'把无条件强制上涨改为针对对应短板实现优化时相对上一版本至少提高5分。',3:'明确提示词限定评估及修改范围，使反馈迭代针对当前创意方向。',4:'新增条件解锁DAG状态机、九个工作步骤、完成状态字段及解锁条件。',5:'由原权利要求4调整为从属项；补入尾帧地址并整理逐幕生成、同源双视图和后端保存关系。',6:'由原权利要求5调整而来，明确幕摘要用于确定后续片段组织结构。',7:'由原权利要求6调整为从属项，整理片段读取、总时长、音乐降级、裁剪、混音和拼接。',8:'由原权利要求7调整而来，明确首帧或实拍参考图、缓慢缩放、兜底标记和参与拼接。',9:'由原权利要求8调整而来，并补入条件解锁状态机、时长确定及背景音乐降级关系。'}
basis={1:'原说明书[0005]—[0007]；原权利要求1。',2:'原说明书[0005]、[0008]；原权利要求2。',3:'原说明书[0005]；原权利要求3。',4:'原说明书[0003]、[0004]及图3。',5:'原说明书[0006]及附图说明；原权利要求4。',6:'原说明书[0006]；原权利要求5。',7:'原说明书[0007]、[0008]及图4；原权利要求1、6。',8:'原说明书[0007]、[0008]及图4；原权利要求7。',9:'原说明书[0003]—[0007]；原权利要求8。'}
map_orig={1:'1',2:'2',3:'3',4:'说明书新增从属项',5:'4',6:'5',7:'6',8:'7',9:'8'}

def footer(canvas,doc):
    canvas.saveState(); canvas.setFont('SimSun',8); canvas.drawCentredString(A4[0]/2,12*mm,'申请号 2026109280496'); canvas.restoreState()

def make(path,story):
    d=SimpleDocTemplate(str(path),pagesize=A4,rightMargin=18*mm,leftMargin=20*mm,topMargin=18*mm,bottomMargin=20*mm,title=path.stem,author='康泽铭')
    d.build(story,onFirstPage=footer,onLaterPages=footer)

# comparison
story=[Paragraph('权利要求书修改对照页',title),Paragraph('申请号 2026109280496',subtitle),Paragraph('说明：本对照页用于说明由原8项权利要求调整为9项权利要求的修改关系。修改后的完整文本以《权利要求书全文替换页》为准。',body)]
data=[[Paragraph(x,center) for x in ['修改后权项','对应原权项','修改内容','原始依据']]]
for n in range(1,10): data.append([Paragraph(str(n),center),Paragraph(map_orig[n],center),Paragraph(summary[n],cell),Paragraph(basis[n],cell)])
t=Table(data,colWidths=[17*mm,29*mm,77*mm,48*mm],repeatRows=1,hAlign='CENTER')
t.setStyle(TableStyle([('FONTNAME',(0,0),(-1,-1),'SimSun'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#D9EAF7')),('TEXTCOLOR',(0,0),(-1,0),colors.black),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#B7B7B7')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
story += [t,Spacer(1,7*mm),Paragraph('不超范围说明',h1),Paragraph('上述修改均以原申请文件的明确记载为依据，未加入原说明书和原权利要求未记载的模型结构、评分公式、事务机制或其他新的技术内容。修改后的权利要求保护主题仍为原申请公开的AI影视前期制作工作流、结构化分镜及视频合成方案。',body)]
make(OUT/'02_权利要求书修改对照页.pdf',story)

# statement body and basis
story=[Paragraph('主动修改意见陈述正文及原始依据表',title),Paragraph('申请号 2026109280496',subtitle),Paragraph('发明名称：一种基于AI工作流的影视前期制作方法及系统',body),Paragraph('陈述事项：主动提出修改（根据《中华人民共和国专利法实施细则》第五十七条第一款）',body),Paragraph('陈述正文',h1)]
for s in [
'申请人在法定主动修改期限内提交本次主动修改文件。申请人此前提交的意见陈述书未附权利要求书全文替换页及修改对照页，未形成完整的权利要求替换文本。本次提交随附《权利要求书全文替换页》和《权利要求书修改对照页》，申请人请求以本次提交的九项权利要求作为后续审查基础。',
'本次修改主要包括：对权利要求1中幕结构及视频合成相关限定进行整理；明确创意版本评价和反馈迭代的适用条件；增加条件解锁DAG状态机引擎的从属限定；整理Shot分镜数据结构、逐幕生成、拖拽排序、后端保存和双视图同源显示关系；进一步明确视频片段时序读取、总时长计算、AI音乐生成降级、静音音轨回退、音频裁剪、混音、视频拼接以及片段生成失败时的兜底机制；对系统权利要求作相应调整。',
'上述修改均能够在原说明书、原权利要求书及附图中找到依据，未引入新的技术内容，未超出原说明书和权利要求书记载的范围。申请人请求国家知识产权局以本次权利要求书全文替换页为基础继续审查。']:
    story.append(Paragraph(s,body))
story += [Paragraph('附件清单',h1),Paragraph('1. 权利要求书全文替换页，共2页；',body),Paragraph('2. 权利要求书修改对照页。',body),Paragraph('提交前核对项',h1)]
for s in ['确认已收到进入实质审查阶段通知书，或本次与实质审查请求同时提交；','填写系统中的真实提交日期、通知书发文日及发文序号；','确认电子系统显示三份文件均已上传并进入待提交清单；','正式提交前再次核对局端当前权利要求版本。']:
    story.append(Paragraph('• '+s,body))
story += [PageBreak(),Paragraph('逐项原始依据',h1)]
data=[[Paragraph(x,center) for x in ['权项','主要限定','原申请依据']]]
for n in range(1,10): data.append([Paragraph(str(n),center),Paragraph(summary[n],cell),Paragraph(basis[n],cell)])
t=Table(data,colWidths=[16*mm,100*mm,55*mm],repeatRows=1,hAlign='CENTER')
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#D9EAF7')),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#B7B7B7')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
story.append(t)
make(OUT/'03_主动修改意见陈述正文及原始依据表.pdf',story)
for p in [OUT/'02_权利要求书修改对照页.pdf',OUT/'03_主动修改意见陈述正文及原始依据表.pdf']:
    print(p,p.stat().st_size)
