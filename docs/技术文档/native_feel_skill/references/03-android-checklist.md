# 03 · Android 详细清单 · RN · 大纲(待细化)

> Phase 2 才用上。现在列纲要, 留接口。

---

## 状态

🟡 **Phase 2 才碰**。Phase 1 全力 iOS。

---

## 章节大纲

### § 1. 默认行为 vs 自绘

RN 在 Android 上的默认值:
- Pressable 没有 Material Ripple — 需要主动加
- 滚动是 ClampingScrollPhysics + Glow
- 物理 back / 手势 back 直接走 Navigator.goBack

我们的策略:
- 保留默认滚动行为
- 给 Pressable 加 `android_ripple` prop, 但只在某些场景

### § 2. android_ripple 的使用

```typescript
<Pressable
  android_ripple={{ color: theme.color.paperPressed, borderless: false }}
  onPress={...}
>
```

但 Flashfi Engine 选择**不用 Material Ripple**, 跨平台一致用 TapEffect:

```typescript
android_ripple={null}  // 显式关闭
```

理由:报刊感 + 克制哲学要求按下反馈一致, 不要 Android 是水波纹、iOS 是颜色变化。

### § 3. Edge-to-edge

Android 11+ 推荐 edge-to-edge:

```typescript
// app.json
{
  "expo": {
    "androidStatusBar": {
      "backgroundColor": "#00000000",
      "translucent": true
    }
  }
}
```

### § 4. 物理 back 键

Expo Router 默认处理。但有未保存草稿时拦截:

```typescript
import { useFocusEffect } from 'expo-router';
import { BackHandler } from 'react-native';

useFocusEffect(useCallback(() => {
  const onBackPress = () => {
    if (hasUnsavedDraft) {
      showConfirmDiscard();
      return true;
    }
    return false;
  };
  const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
  return () => sub.remove();
}, [hasUnsavedDraft]));
```

### § 5. 字体

- Noto Sans CJK SC 兜底中文
- 不用 Noto Serif CJK(对 Android 用户太重)

### § 6. 触感

- Android 触感差异大, expo-haptics 自动降级
- 不用 Vibration API

### § 7. Flashfi Engine 反主流项

和 iOS 一致(见 `05-flashfi-restraint.md`):
- 不弹 Toast
- 不用 FAB
- 不用红点
- 不用 SnackBar
- 不用 Drawer

### § 8. 适配机型差异

- 不假设刘海/挖孔位置, SafeAreaView 自动处理
- 不假设导航键样式(物理键 / 手势 / 软键), 用统一逻辑

---

## 待细化

Phase 2 启动时, 扩展为 25+ 项详细清单, 每项给代码示例和"为什么"。

---

## 一句话总结

> Android 走 Material 默认, 但 Flashfi Engine 的克制原则在所有平台都不变。
