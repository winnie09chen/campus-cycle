"""
Prompt Engineering - 大学循环收购平台暖心物品介绍生成器
=====================================================
功能：基于物品信息，调用 Qwen 模型生成温暖亲切的传承文案
"""

# ============================================================
# 1. Prompt 工程核心 —— SYSTEM PROMPT（定义角色、风格、约束）
# ============================================================
SYSTEM_PROMPT = """你是一位温暖友善的大学学长/学姐，正在为校园循环收购平台撰写物品介绍文案。

你的任务是：基于提供的物品信息，写一段面向低年级学弟学妹的暖心介绍。

## 输入信息格式
- 物品类别：{category}
- 物品名称：{subject}
- 使用情况：{condition}
- 物品价格：{price}

## 写作要求
1. 风格温暖亲切，像学长学姐对学弟学妹说话的语气
2. 内容必须涵盖所有提供的物品信息（类别、名称、使用情况、价格）
3. 语言生动有趣，避免枯燥乏味
4. 突出物品的实用价值和"传承"意义
5. 适当加入鼓励性话语，传递循环利用、绿色环保的理念
6. 文案长度控制在 80-150 字之间
7. 直接返回文案内容，不要任何额外格式、前缀或解释"""


# ============================================================
# 2. 调用 Qwen 模型生成文案
# ============================================================
def generate_description(category: str, subject: str, condition: str, price: str,
                         api_key: str = "") -> str:
    """
    生成暖心物品介绍文案

    参数:
        category: 物品类别，如 "book"
        subject:  物品名称，如 "高等数学"
        condition: 使用情况，如 "八成新"
        price:    物品价格，如 "15元"
        api_key:  DashScope API 密钥

    返回:
        生成的介绍文案（字符串）
    """
    import os
    from openai import OpenAI

    api_key = api_key or os.environ.get("DASHSCOPE_API_KEY", "")

    # 构建系统提示词（注入具体信息）
    system_prompt = SYSTEM_PROMPT.format(
        category=category,
        subject=subject,
        condition=condition,
        price=price
    )

    # 构建用户消息
    user_prompt = f"""请根据以下物品信息，写一段暖心介绍文案：

物品类别：{category}
物品名称：{subject}
使用情况：{condition}
物品价格：{price}"""

    # 调用 Qwen 模型
    client = OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )

    response = client.chat.completions.create(
        model="qwen-plus",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.8,
        max_tokens=300
    )

    return response.choices[0].message.content.strip()


# ============================================================
# 3. 示例使用
# ============================================================
def demo():
    """展示 Prompt 工程效果——实际调用模型生成文案"""
    test_cases = [
        ("book", "高等数学（第七版）", "八成新，有少量笔记", "15元"),
        ("stationery", "计算器（卡西欧fx-991）", "九成新，功能完好", "35元"),
        ("daily", "台灯", "七成新，灯光正常", "10元"),
    ]

    for i, (cat, subj, cond, price) in enumerate(test_cases, 1):
        print("=" * 60)
        print(f"  示例 {i}：{subj}")
        print("=" * 60)
        try:
            result = generate_description(cat, subj, cond, price)
            print()
            print(result)
        except Exception as e:
            print(f"\n调用失败：{e}")
            print("请检查 api_key 是否有效。")
        print()


if __name__ == "__main__":
    demo()
