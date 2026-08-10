import type { Category, Transaction, TransactionType } from './types.js';

/**
 * 商户名/备注 → 分类的自动匹配规则。
 * 关键词按默认分类名（DEFAULT_INCOME_CATEGORIES / DEFAULT_EXPENSE_CATEGORIES）组织；
 * 若用户重命名了分类，匹配不到同名分类时保持未分类（不会硬塞）。
 */
export interface AutoCategoryRule {
  /** 目标分类名（与分类列表中的 name 对应） */
  category: string;
  /** 命中关键词（对 counterparty + note 做包含匹配，不区分大小写） */
  keywords: string[];
}

/** 支出分类关键词规则 */
export const EXPENSE_AUTO_RULES: AutoCategoryRule[] = [
  {
    category: '餐饮',
    keywords: [
      '美团', '饿了么', '外卖', '餐厅', '饭店', '食堂', '肯德基', '麦当劳', '必胜客', '汉堡王',
      '星巴克', '瑞幸', '库迪', '喜茶', '奈雪', '蜜雪冰城', '茶百道', '古茗', '咖啡', '奶茶',
      '小吃', '烧烤', '火锅', '快餐', '便当', '叮咚', '盒马', '买菜', '菜市场', '菜场',
    ],
  },
  {
    category: '交通',
    keywords: [
      '滴滴', 't3出行', '曹操出行', '花小猪', '地铁', '公交', '12306', '铁路', '火车', '高铁',
      '机票', '航空', '航班', '携程', '去哪儿', '飞猪', '同程', '加油', '石化', '石油', '加油站',
      '停车', 'etc', '共享单车', '哈啰', '青桔', '美团单车', '出租车', '网约车', '打车',
    ],
  },
  {
    category: '购物',
    keywords: [
      '淘宝', '天猫', '京东', '拼多多', '唯品会', '苏宁', '国美', '抖音商城', '快手小店', '小红书',
      '得物', '闲鱼', '亚马逊', '沃尔玛', '永辉', '大润发', '华润', '家乐福', '山姆', 'costco',
      '便利店', '7-11', '711', '全家', '罗森', '屈臣氏', '优衣库', 'zara', '无印良品', '小米',
      '苹果', '华为', '京东到家', '菜鸟', '快递', '顺丰', '韵达', '中通', '圆通', '申通', '邮政',
    ],
  },
  {
    category: '居住',
    keywords: [
      '房租', '租金', '物业', '水电', '电费', '水费', '燃气', '电网', '电力', '自来水', '供暖',
      '暖气', '自如', '贝壳', '链家', '我爱我家', '蛋壳',
    ],
  },
  {
    category: '娱乐',
    keywords: [
      '腾讯视频', '爱奇艺', '优酷', '哔哩', 'b站', '网易云', 'qq音乐', '酷狗', '斗鱼', '虎牙',
      'steam', 'epic', '王者', '原神', '阴阳师', '游戏', '电影院', '影城', '猫眼', '淘票票', 'ktv',
      '会员', 'netflix', 'spotify', 'disney',
    ],
  },
  {
    category: '医疗',
    keywords: [
      '医院', '诊所', '门诊', '药房', '药店', '大药房', '同仁堂', '体检', '挂号', '牙科', '口腔',
      '眼科', '京东健康', '阿里健康',
    ],
  },
  {
    category: '教育',
    keywords: [
      '课程', '培训', '网课', '知乎', '喜马拉雅', 'kindle', '当当', '书店', '考试', '驾校', '学费',
      '辅导',
    ],
  },
  {
    category: '人情',
    keywords: ['红包', '随礼', '份子钱', '礼金', '请客'],
  },
  {
    category: '其他',
    keywords: [
      '中国移动', '中国联通', '中国电信', '话费', '流量', '充值', '宽带',
    ],
  },
];

/** 收入分类关键词规则 */
export const INCOME_AUTO_RULES: AutoCategoryRule[] = [
  {
    category: '工资',
    keywords: ['工资', '薪资', '薪金', '代发', '工资代发', '公司', '补贴', '奖金', '报销'],
  },
  {
    category: '理财',
    keywords: ['理财', '基金', '利息', '收益', '余额宝', '零钱通', '股票', '证券', '分红', '赎回', '国债'],
  },
  {
    category: '红包',
    keywords: ['红包', '压岁钱', '利是'],
  },
  {
    category: '兼职',
    keywords: ['兼职', '劳务', '稿费', '佣金', '提成', '打赏', '赞赏', '咨询', '服务费', '报酬'],
  },
  {
    category: '其他',
    keywords: ['退款', '转账', '收款'],
  },
];

/** 根据文本（商户名 + 备注）与交易类型猜测分类名；未命中返回 null */
export function guessCategoryName(text: string, type: TransactionType): string | null {
  if (type !== 'income' && type !== 'expense') return null;
  const rules = type === 'income' ? INCOME_AUTO_RULES : EXPENSE_AUTO_RULES;
  const lower = text.toLowerCase();
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.category;
    }
  }
  return null;
}

/** 查找 kind 匹配且 name 相同的分类 id；找不到返回 null */
function findCategoryId(categories: Category[], kind: 'income' | 'expense', name: string): string | null {
  return categories.find((c) => c.kind === kind && c.name === name)?.id ?? null;
}

/**
 * 对交易列表批量应用自动分类：
 * - 仅处理 type 为 income/expense 且尚未分类（categoryId 为空）的交易；
 * - 已分类、转账、中性交易保持不变；
 * - 规则命中但分类列表中无同名分类（用户重命名/删除）时保持未分类。
 * 返回新数组，不修改入参。
 */
export function applyAutoCategory(transactions: Transaction[], categories: Category[]): Transaction[] {
  return transactions.map((tx) => {
    if (tx.categoryId || (tx.type !== 'income' && tx.type !== 'expense')) return tx;
    const name = guessCategoryName(`${tx.counterparty} ${tx.note}`, tx.type);
    if (!name) return tx;
    const id = findCategoryId(categories, tx.type, name);
    if (!id) return tx;
    return { ...tx, categoryId: id, updatedAt: new Date().toISOString() };
  });
}
