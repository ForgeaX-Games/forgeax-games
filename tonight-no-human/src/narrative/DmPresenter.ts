/** DM presenter skin (Katrina sugar etc.) — visual/VO stub. */
export class DmPresenter {
  skinId: string;

  constructor(skinId = 'katrina_sugar') {
    this.skinId = skinId;
  }

  line(key: string): string {
    const table: Record<string, string> = {
      welcome: '欢迎落入万灵糖境——今晚，别变回人。',
      cast: '把材料丢进坩埚吧。谁变成谁，由糖神决定。',
      reveal: '看看你被做成了什么……',
      settle: '糖衣碎裂的声音，篮子又沉了一层。',
      finale: '天亮之前——你们还认得彼此吗？',
    };
    return table[key] ?? key;
  }
}
