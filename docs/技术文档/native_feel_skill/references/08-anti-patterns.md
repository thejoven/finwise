# 08 · 反模式禁止清单 · RN

> 这一份是负向清单——不该做的事。
> 比正向清单更重要, 因为这些是"看起来对其实错"的诱惑。
>
> 每一条配一个为什么。

---

## 一、组件反模式 (10 项)

### A.1 ❌ 不用 RN 自带 `<Button>`

```typescript
// ❌
import { Button } from 'react-native';
<Button title="签字" onPress={...} />

// ✓ 自绘
<Pressable onPress={...}>
  <Text>签字</Text>
</Pressable>
```

**为什么**:RN 默认 Button 在 iOS 上是蓝色文字、Android 上是 Material 按钮, 没有控制力。

### A.2 ❌ 不用 TouchableOpacity 的默认 activeOpacity

```typescript
// ❌
<TouchableOpacity onPress={...}>

// ✓
<Pressable
  onPress={...}
  style={({pressed}) => [
    styles.button,
    pressed && styles.pressed,
  ]}
>
```

**为什么**:默认 opacity 0.2 看起来"web 风", 不像 iOS 系统按钮。
iOS 按钮按下是颜色变化, 不是透明度变化。

### A.3 ❌ 不用 Alert.alert

```typescript
// ❌
Alert.alert('确认', '放弃这张草稿?', [...]);

// ✓ 自绘 ActionSheet
<ActionSheet visible={...} title="放弃这张草稿?" actions={[...]} />
```

**为什么**:Alert 视觉无法控制, 跨平台样式不一致, 且和 财富密码 的设计语言冲突。

### A.4 ❌ 不用 ActivityIndicator

```typescript
// ❌
<ActivityIndicator />

// ✓ 不显示, 或打字机效果
```

见 `05-wiseflow-restraint.md` § 1.3。

### A.5 ❌ 不用 Switch 默认样式

```typescript
// ❌
<Switch value={on} onValueChange={setOn} />

// ✓ 配色 + 平台分流
<Switch
  value={on}
  onValueChange={setOn}
  trackColor={{
    false: theme.color.paperPressed,
    true: theme.color.ink,
  }}
  ios_backgroundColor={theme.color.paperPressed}
  thumbColor={Platform.OS === 'ios' ? undefined : theme.color.paper}
/>
```

### A.6 ❌ 不用 react-native-vector-icons

```typescript
// ❌ 老旧库, 字体冲突多
import Icon from 'react-native-vector-icons/Ionicons';
```

```typescript
// ✓ lucide-react-native, 现代 + 一致 stroke
import { Search, Plus } from 'lucide-react-native';
<Search size={20} color={theme.color.ink} strokeWidth={1.5} />
```

### A.7 ❌ 不用 RN 自带的 Modal

```typescript
// ❌ 老旧 API, 没有手势
import { Modal } from 'react-native';

// ✓ Expo Router 的 modal presentation
// app/_layout.tsx
<Stack.Screen name="capture" options={{ presentation: 'modal' }} />
```

例外:确认 ActionSheet 这种本地组件可以用 Modal 作为容器, 但要自绘外观。

### A.8 ❌ 不用 SafeAreaView from 'react-native'

```typescript
// ❌ RN 自带的 SafeAreaView 不支持精细 edges
import { SafeAreaView } from 'react-native';

// ✓ react-native-safe-area-context
import { SafeAreaView } from 'react-native-safe-area-context';
<SafeAreaView edges={['top', 'bottom']}>...</SafeAreaView>
```

### A.9 ❌ 不用 ScrollView + map 渲染长列表

```typescript
// ❌ (> 20 项时)
<ScrollView>
  {signals.map(s => <SignalItem key={s.id} signal={s} />)}
</ScrollView>

// ✓
<FlatList
  data={signals}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <SignalItem signal={item} />}
/>
```

### A.10 ❌ 不用 Image 不带尺寸

```typescript
// ❌ 性能差, 闪烁
<Image source={uri} />

// ✓ 显式尺寸 + caching
<Image
  source={uri}
  style={{ width: 80, height: 80 }}
  resizeMode="cover"
/>

// 更好: expo-image
import { Image } from 'expo-image';
<Image
  source={uri}
  style={{ width: 80, height: 80 }}
  contentFit="cover"
  placeholder={blurhash}
/>
```

---

## 二、样式反模式 (8 项)

### B.1 ❌ 不写 inline style 大块

```typescript
// ❌
<View style={{
  flex: 1,
  padding: 16,
  backgroundColor: '#fafaf7',
  borderRadius: 14,
  borderWidth: 1,
  borderColor: '#d6d4ce',
  marginVertical: 8,
}}>

// ✓ StyleSheet.create
const styles = StyleSheet.create({
  card: { ... },
});
<View style={styles.card}>
```

理由:StyleSheet 编译期校验 + 性能优化 + 可复用。

### B.2 ❌ 不硬编码颜色

```typescript
// ❌
<View style={{ backgroundColor: '#fafaf7' }} />

// ✓
<View style={{ backgroundColor: theme.color.paper2 }} />
```

### B.3 ❌ 不用 flex: 1 在所有地方

```typescript
// ❌ 滥用
<View style={{ flex: 1 }}>
  <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }}>
```

理解 flex 的真实含义, 多数情况下用具体尺寸或 flexGrow。

### B.4 ❌ 不写 percentage 高度

```typescript
// ❌
<View style={{ height: '50%' }}>

// ✓ 用 Dimensions 或 flex
import { Dimensions } from 'react-native';
const { height } = Dimensions.get('window');
```

### B.5 ❌ 不用 borderWidth: 1 当分割线

```typescript
// ❌
<View style={{ borderBottomWidth: 1, borderBottomColor: '#d6d4ce' }}>

// ✓
<View style={{
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: theme.color.ruleSoft,
}}>
```

### B.6 ❌ 不写阴影不带 elevation

```typescript
// ❌ 只 iOS 有阴影, Android 没
<View style={{
  shadowColor: '#000',
  shadowOpacity: 0.1,
  shadowRadius: 4,
}}>

// ✓ 跨平台一致
<View style={{
  ...Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12 },
    android: { elevation: 4 },
  })
}}>
```

但 财富密码 几乎不用阴影。

### B.7 ❌ 不用奇怪的字号 / 间距数字

```typescript
// ❌
fontSize: 13.5, padding: 7

// ✓ 走 token
fontSize: theme.fontSize.subhead, padding: theme.spacing.sm
```

### B.8 ❌ 不写多层嵌套 View

```typescript
// ❌
<View><View><View><Text>...</Text></View></View></View>

// ✓
<View><Text>...</Text></View>
```

如果需要 padding + 背景色 + 圆角, 一个 View 用 style 解决。

---

## 三、状态管理反模式 (6 项)

### C.1 ❌ 不在组件里管理服务器状态

```typescript
// ❌
function SignalList() {
  const [signals, setSignals] = useState([]);
  
  useEffect(() => {
    fetch('/v1/signals').then(...).then(setSignals);
  }, []);
}

// ✓
function SignalList() {
  const { data: signals } = useQuery({
    queryKey: ['signals'],
    queryFn: () => api.getSignals(),
  });
}
```

### C.2 ❌ 不在 useEffect 里写 async

```typescript
// ❌
useEffect(async () => {  // 警告: useEffect 不接受 async
  const data = await fetch(...);
}, []);

// ✓
useEffect(() => {
  (async () => {
    const data = await fetch(...);
  })();
}, []);

// 更好: 用 TanStack Query
```

### C.3 ❌ 不在 useState 里存派生状态

```typescript
// ❌
const [filtered, setFiltered] = useState([]);
useEffect(() => {
  setFiltered(signals.filter(s => s.pending));
}, [signals]);

// ✓
const filtered = useMemo(
  () => signals.filter(s => s.pending),
  [signals]
);
```

### C.4 ❌ 不滥用 Context

```typescript
// ❌ 用 Context 管全局服务器状态, rerender 噩梦
<UserContext.Provider value={user}>
  <SignalsContext.Provider value={signals}>
    ...

// ✓ TanStack Query + Zustand
```

### C.5 ❌ 不在 setState 后立即用旧值

```typescript
// ❌
setCount(count + 1);
console.log(count);  // 还是旧值

// ✓
setCount(prev => prev + 1);
```

### C.6 ❌ 不忘了 cleanup

```typescript
// ❌ 没清理订阅, 组件卸载后 setState 报警告
useEffect(() => {
  const sub = something.subscribe(setData);
}, []);

// ✓
useEffect(() => {
  const sub = something.subscribe(setData);
  return () => sub.unsubscribe();
}, []);
```

---

## 四、交互反模式 (6 项)

### D.1 ❌ 不拦截左滑返回手势(大多数情况)

```typescript
// ❌
<Stack.Screen options={{ gestureEnabled: false }} />
```

例外:录入页有未保存草稿时, 用 useNavigation hook 监听 beforeRemove 事件:

```typescript
useEffect(() => {
  const unsub = navigation.addListener('beforeRemove', (e) => {
    if (!hasUnsavedDraft) return;
    e.preventDefault();
    showConfirmDiscard();
  });
  return unsub;
}, [hasUnsavedDraft]);
```

### D.2 ❌ 不实时校验弹错误

```typescript
// ❌
<TextInput
  onChangeText={(t) => {
    setText(t);
    if (t.length < 3) setError('太短');
  }}
/>
```

校验放在提交时, 不实时打扰用户。

### D.3 ❌ 不用 onLongPress 作为主要交互

长按是隐藏交互, 新用户不会发现。所有动作必须有明确按钮。

例外:列表项长按弹复制菜单等系统级行为可以保留。

### D.4 ❌ 不用 swipe-to-delete

见 `05-wiseflow-restraint.md` § 5.2。

### D.5 ❌ 不让用户摇晃手机触发动作

不监听 `DeviceMotion` 做"摇一摇撤销"。所有动作走 UI。

### D.6 ❌ 不每个动作都需要确认

只有不可逆动作才需要确认(签字、放弃草稿)。
归档、收藏、跳转都不需要。

---

## 五、性能反模式 (5 项)

### E.1 ❌ 不在 render 里创建函数

```typescript
// ❌ 每次 render 都创建新函数, 子组件重渲
<Child onPress={() => doStuff(item.id)} />

// ✓
const handlePress = useCallback(() => doStuff(item.id), [item.id]);
<Child onPress={handlePress} />
```

### E.2 ❌ 不在 render 里创建对象

```typescript
// ❌
<View style={{ flex: 1 }}>  // 每次新对象, 实测影响 RN 性能

// ✓
<View style={styles.container}>
```

### E.3 ❌ 不在 FlatList 里 inline renderItem

```typescript
// ❌
<FlatList renderItem={({ item }) => <Item data={item} />} />

// ✓
const renderItem = useCallback(({ item }) => <Item data={item} />, []);
<FlatList renderItem={renderItem} />
```

### E.4 ❌ 不忘 keyExtractor

```typescript
// ❌
<FlatList data={signals} renderItem={...} />
// React 用 index 作 key, 数据变化时复用错乱

// ✓
<FlatList
  data={signals}
  keyExtractor={(item) => item.id}
  renderItem={...}
/>
```

### E.5 ❌ 不用 setTimeout 做轮询

```typescript
// ❌
useEffect(() => {
  const id = setInterval(() => fetch(...), 5000);
  return () => clearInterval(id);
}, []);

// ✓ TanStack Query 的 refetchInterval
useQuery({
  queryKey: ['signals'],
  queryFn: ...,
  refetchInterval: 5000,
});
```

---

## 六、文案反模式 (4 项)

### F.1 ❌ 不说 "Loading..."

见 `05-wiseflow-restraint.md` § 4.4。

### F.2 ❌ 不在错误信息加 emoji

```typescript
// ❌
<Text>哎呀, 出错了 😢</Text>

// ✓
<Text>网络异常, 稍后自动重试</Text>
```

### F.3 ❌ 不用反问句作按钮文案

```typescript
// ❌
<Pressable><Text>你确定吗?</Text></Pressable>

// ✓
<Pressable><Text>放弃</Text></Pressable>
```

### F.4 ❌ 不用感叹号

```typescript
// ❌
<Text>已签字!</Text>

// ✓
<Text>已签字</Text>
// 或不显示
```

---

## 七、财富密码 哲学反模式 (6 项)

### G.1 ❌ 不显示连续打卡天数 / Streak

不做游戏化。

### G.2 ❌ 不显示使用度量

"今日推演 3 次"、"本周训练 5 次" 这类指标会让用户为指标用产品。

### G.3 ❌ 不让用户分享 / 邀请朋友

```typescript
// ❌ 不安装
// react-native-share
// react-native-invite-friends
```

### G.4 ❌ 不在 Settings 堆"高级设置"

Phase 1 Settings 只有: 退出登录、关于。

### G.5 ❌ 不显示百分比进度

```typescript
// ❌
<Text>能力地图: 已掌握 42%</Text>

// ✓
<Text>二阶推演 · 持续漏</Text>
```

### G.6 ❌ 不弹"新版本上线"通知

新功能让用户自己发现。

---

## 自查命令

提交 PR 前 grep 一遍:

```bash
# 应该没有任何结果
grep -rE "Alert\.alert|<Button |ActivityIndicator" src/

# 应该没有任何结果
grep -rE "from 'react-native-toast|from 'react-native-paper" package.json

# Material 风格组件应该极少
grep -rE "TouchableOpacity" src/ | wc -l  # 应该 < 5(主要在 TapEffect 实现里)
```

如果搜到了, 过一遍这份文档对应章节。

---

## 一句话总结

> **正向清单告诉你"做什么"。反模式清单告诉你"为什么不能那样"。**
>
> "那样"通常是 RN 教程第一选择, 也是 AI 第一推荐。
>
> 财富密码 之所以是 财富密码, 一半在做了什么, 一半在没做什么。
