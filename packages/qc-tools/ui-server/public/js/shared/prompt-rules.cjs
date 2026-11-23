// Universal pure rules: CommonJS for Node; a single namespace for classic browser scripts.
(function (root) {
function extractLocalSmartPrompt(narrationText, targetMode, keywords = [], templateStyle = 'data_card') {
  if (!narrationText) return '';
  const raw = narrationText.trim();
  const kwList = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  let cleaned = raw
    .replace(/^(在|顺着|沿着|当|经过|据|由于|因为|为了|根据)[^，,。；;]{1,15}[，,]/g, '')
    .replace(/^(有一条|坐落着|迎面出现的却是|映入眼帘的是|矗立着|车辆必须|这就是|可以说|事实上|实际上)/g, '')
    .replace(/[，,。；;！!？?]+$/g, '')
    .trim();

  if (cleaned.length < 4) cleaned = raw.replace(/[，,。；;！!？?]+$/g, '');

  const mainSubject = kwList.length > 0 ? kwList[0] : (cleaned.length > 25 ? cleaned.slice(0, 25) : cleaned);
  const contextDesc = cleaned;

  let cameraMove = '平稳推镜头向前聚焦';
  if (/转弯|急弯|弯道|穿行|盘山|环绕/.test(raw)) {
    cameraMove = '大范围航拍连续弧形环绕跟随';
  } else if (/落差|悬崖|山峰|俯瞰|冲上|高度|海拔/.test(raw)) {
    cameraMove = '高空俯冲推拉运镜转开阔全景';
  } else if (/细节|金箔|雕刻|纹理|双眼|双手|微观|精细|古老|建筑/.test(raw)) {
    cameraMove = '慢速微距浅景深焦点平移特写';
  } else if (/穿过|延伸|漫步|走入|深入/.test(raw)) {
    cameraMove = '第一人称低角度正前向稳定推进运镜';
  }

  if (targetMode === 'video') {
    let videoSubject = mainSubject;
    if (/修验|苦行|神域|上人|僧|行者/.test(raw)) {
      videoSubject = '修验道白衣苦行僧在险峰岩壁间手持金刚杖前行';
    } else if (/德川|幕府|防线|关卡|东照宫|灵庙|家康/.test(raw)) {
      videoSubject = '德川幕府森严石鸟居与关防石垣在晨雾险峰中矗立';
    } else if (/发卡弯|急弯|伊吕波|公路|盘山|弯道/.test(raw)) {
      videoSubject = '48道急弯发卡弯在险峻山体间连续折叠延伸';
    } else if (/避暑|公馆|外交|洋馆|使节|使馆/.test(raw)) {
      videoSubject = '中禅寺湖畔西洋木造使馆公馆倒映在冷凉湖水间';
    }
    return `【镜头主体】${videoSubject}，画面生动呈现「${contextDesc}」；【运镜设计】${cameraMove}；【光影与质感】自然光影真实漫反射，丰富环境层次，电影级光学动态细节`;
  } else if (targetMode === 'image') {
    let visualSubject = mainSubject;
    let visualDetails = contextDesc;
    if (/修验|苦行|神域|上人|僧|行者/.test(raw)) {
      visualSubject = '险峰绝壁悬崖边缘的修验道白衣苦行僧持杖背影，与苍茫古道注连绳结界';
    } else if (/德川|幕府|防线|关卡|东照宫|灵庙|家康/.test(raw)) {
      visualSubject = '日光险隘处的德川幕府金漆葵纹铜装石鸟居，与崇山峻岭间森严防御石垣';
    } else if (/发卡弯|急弯|伊吕波|公路|盘山|弯道/.test(raw)) {
      visualSubject = '日光山林海间蜿蜒盘旋的48道发卡弯绝壁险道高空俯瞰轨迹';
    } else if (/避暑|公馆|外交|洋馆|使节|使馆/.test(raw)) {
      visualSubject = '中禅寺湖畔清幽冷凉的西洋木造外交使馆别墅与百叶窗湖光倒影';
    }
    return `【画面叙事核心】大师级摄影定格「${visualSubject}」，核心表意细节：${visualDetails}；【构图与空间透视】大景深险峰空间层次，环境空气透视；【细节与质感】微米级物理材质特写（粗麻衣袍、金刚杖斑驳纹理、黑金铜雕葵纹），8K超写实胶片光影，无杂乱文字`;
  } else {
    // 📊 动效排版卡片形态：由大模型自适应调优排版指导词
    const title = mainSubject.length > 10 ? mainSubject.slice(0, 8) : mainSubject;
    return `【核心大字】「${title}」\n【副级阐述】${contextDesc}\n【排版与认知重点】大模型自适应调优，突出核心论点与认知反差\n【版式视觉】16:9 现代暗色高阶演示卡片，微光磨砂玻璃容器，冷蓝与渐变紫辉光，顶级信息图排版`;
  }
}

const rules = Object.freeze({ extractLocalSmartPrompt });
if (typeof module !== 'undefined' && module.exports) module.exports = rules;
else root.WhyVideoPromptRules = rules;
})(globalThis);
