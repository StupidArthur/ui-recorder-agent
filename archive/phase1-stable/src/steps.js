module.exports = [
  {
    title: '打开客户列表',
    detail: '进入系统首页，加载全部客户数据',
    async run({ page, sleep }) {
      await page.waitForSelector('tbody tr');
      await sleep(800);
    },
  },
  {
    title: '输入筛选条件',
    detail: '在「客户姓名」输入框中键入关键字「张」',
    async run({ page, type, sleep }) {
      await type(page.locator('#kw'), '张', '输入姓名关键字');
      await sleep(500);
    },
  },
  {
    title: '执行查询',
    detail: '点击查询按钮，筛选出匹配的客户记录',
    async run({ page, click, sleep }) {
      await click(page.locator('#search'), '点击查询');
      await sleep(800);
    },
  },
  {
    title: '选择目标客户',
    detail: '定位到客户「张三」，点击行末的编辑操作',
    async run({ page, click, sleep }) {
      await click(page.locator('tbody tr', { hasText: '张三' }).locator('button.link'), '编辑该客户');
      await page.waitForSelector('#mask.show');
      await sleep(700);
    },
  },
  {
    title: '调整客户状态',
    detail: '在弹窗中把客户状态修改为「待审核」',
    async run({ page, select, sleep }) {
      await select(page.locator('#m-status'), 'wait', '选择状态');
      await sleep(500);
    },
  },
  {
    title: '保存修改',
    detail: '点击保存按钮，提交本次变更',
    async run({ page, click, sleep }) {
      await click(page.locator('#m-save'), '点击保存');
      await sleep(900);
    },
  },
  {
    title: '操作完成',
    detail: '列表已刷新，客户状态更新成功',
    async run({ page, highlight, sleep }) {
      await highlight(page.locator('tbody tr', { hasText: '张三' }).locator('.tag'), '状态已更新');
      await sleep(1500);
    },
  },
];
