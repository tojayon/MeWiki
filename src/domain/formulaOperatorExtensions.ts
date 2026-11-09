const tex = String.raw;

/** Prefixes whose editable argument is closed by groupClose. */
export const formulaGroupedOperators = {
  derivativeDot: tex`\dot{`, squareRoot: tex`\sqrt{`, cubeRoot: tex`\sqrt[3]{`,
  hatAccent: tex`\hat{`, wideHatAccent: tex`\widehat{`, barAccent: tex`\bar{`,
  overlineAccent: tex`\overline{`, underlineAccent: tex`\underline{`, vectorAccent: tex`\vec{`,
  tildeAccent: tex`\tilde{`, wideTildeAccent: tex`\widetilde{`, doubleDotAccent: tex`\ddot{`,
  overbraceAccent: tex`\overbrace{`, underbraceAccent: tex`\underbrace{`,
  cancelAccent: tex`\cancel{`, boxedAccent: tex`\boxed{`,
} as const;

export const additionalDelimiterPairs = {
  floorOpen: ["floorClose"], ceilOpen: ["ceilClose"], angleOpen: ["angleClose"],
} as const;

// Each tuple is [persistent ID, accessible name, TeX]. Categories stay short
// enough to read vertically beside the compact keyboard.
export const additionalFormulaOperatorGroups = [
  { label: "运算", keys: [
    ["plusMinus", "± 正负", tex`\pm`], ["minusPlus", "∓ 负正", tex`\mp`],
    ["divisionSign", "÷ 除号", tex`\div`], ["asterisk", "∗ 星乘", tex`\ast`],
    ["star", "⋆ 星号", tex`\star`], ["circle", "∘ 复合", tex`\circ`],
    ["bullet", "• 实心点", tex`\bullet`], ["tensorProduct", "⊗ 张量积", tex`\otimes`],
    ["directSum", "⊕ 直和", tex`\oplus`], ["circledMinus", "⊖ 圈减", tex`\ominus`],
    ["circledDot", "⊙ 圈点", tex`\odot`], ["factorial", "! 阶乘", "!"],
    ["bigDirectSum", "⨁ 广义直和", tex`\bigoplus`], ["bigTensorProduct", "⨂ 广义张量积", tex`\bigotimes`],
  ] },
  { label: "关系", keys: [
    ["approximately", "≈ 约等于", tex`\approx`], ["similar", "∼ 相似", tex`\sim`],
    ["similarEqual", "≃ 渐近相等", tex`\simeq`], ["congruent", "≅ 全等", tex`\cong`],
    ["equivalent", "≡ 恒等", tex`\equiv`], ["proportional", "∝ 正比", tex`\propto`],
    ["asymptotic", "≍ 同阶", tex`\asymp`], ["muchLess", "≪ 远小于", tex`\ll`],
    ["muchGreater", "≫ 远大于", tex`\gg`], ["precedes", "≺ 先于", tex`\prec`],
    ["precedesEqual", "≼ 先于等于", tex`\preceq`], ["succeeds", "≻ 后于", tex`\succ`],
    ["succeedsEqual", "≽ 后于等于", tex`\succeq`], ["notLess", "≮ 不小于", tex`\nless`],
    ["notGreater", "≯ 不大于", tex`\ngtr`], ["notLessEqual", "≰ 不小于等于", tex`\nleq`],
    ["notGreaterEqual", "≱ 不大于等于", tex`\ngeq`], ["parallel", "∥ 平行", tex`\parallel`],
    ["notParallel", "∦ 不平行", tex`\nparallel`], ["perpendicular", "⊥ 垂直", tex`\perp`],
    ["definedEqual", "≔ 定义为", tex`\coloneqq`], ["triangleEqual", "≜ 定义等于", tex`\triangleq`],
    ["dotEqual", "≐ 趋近相等", tex`\doteq`],
  ] },
  { label: "结构", keys: [
    ["squareRoot", "平方根", formulaGroupedOperators.squareRoot],
    ["cubeRoot", "立方根", formulaGroupedOperators.cubeRoot],
    ["floorOpen", "向下取整", tex`\left\lfloor`], ["ceilOpen", "向上取整", tex`\left\lceil`],
    ["angleOpen", "尖括号", tex`\left\langle`],
    ["casesTemplate", "分段函数", tex`\begin{cases}0&x<0\\1&x\geq0\end{cases}`],
    ["binomialTemplate", "二项式系数", tex`\binom{n}{k}`],
  ] },
  { label: "集合", keys: [
    ["union", "∪ 并集", tex`\cup`], ["setDifference", "∖ 差集", tex`\setminus`],
    ["notIn", "∉ 不属于", tex`\notin`], ["contains", "∋ 包含元素", tex`\ni`],
    ["subset", "⊂ 真子集", tex`\subset`], ["superset", "⊃ 真超集", tex`\supset`],
    ["supersetEqual", "⊇ 超集", tex`\supseteq`], ["notSubsetEqual", "⊈ 不是子集", tex`\nsubseteq`],
    ["notSupersetEqual", "⊉ 不是超集", tex`\nsupseteq`], ["strictSubset", "⊊ 严格子集", tex`\subsetneq`],
    ["strictSuperset", "⊋ 严格超集", tex`\supsetneq`], ["emptySet", "∅ 空集", tex`\varnothing`],
    ["complement", "∁ 补集", tex`\complement`], ["disjointUnion", "⊎ 不交并", tex`\uplus`],
    ["squareUnion", "⊔ 上确界并", tex`\sqcup`], ["squareIntersection", "⊓ 下确界交", tex`\sqcap`],
    ["bigUnion", "⋃ 广义并", tex`\bigcup`], ["bigIntersection", "⋂ 广义交", tex`\bigcap`],
    ["naturalNumbers", "ℕ 自然数集", tex`\mathbb{N}`], ["integers", "ℤ 整数集", tex`\mathbb{Z}`],
    ["rationalNumbers", "ℚ 有理数集", tex`\mathbb{Q}`], ["realNumbers", "ℝ 实数集", tex`\mathbb{R}`],
    ["complexNumbers", "ℂ 复数集", tex`\mathbb{C}`], ["finiteField", "𝔽 有限域", tex`\mathbb{F}`],
  ] },
  { label: "逻辑", keys: [
    ["logicalAnd", "∧ 逻辑与", tex`\land`], ["logicalOr", "∨ 逻辑或", tex`\lor`],
    ["logicalNot", "¬ 逻辑非", tex`\lnot`], ["forall", "∀ 任意", tex`\forall`],
    ["exists", "∃ 存在", tex`\exists`], ["notExists", "∄ 不存在", tex`\nexists`],
    ["top", "⊤ 真", tex`\top`], ["bottom", "⊥ 假", tex`\bot`],
    ["therefore", "∴ 因此", tex`\therefore`], ["because", "∵ 因为", tex`\because`],
    ["entails", "⊨ 语义蕴涵", tex`\models`], ["proves", "⊢ 可推导", tex`\vdash`],
    ["reverseProves", "⊣ 反向推导", tex`\dashv`],
    ["bigLogicalAnd", "⋀ 广义逻辑与", tex`\bigwedge`], ["bigLogicalOr", "⋁ 广义逻辑或", tex`\bigvee`],
  ] },
  { label: "函数", keys: [
    ["sine", "sin 正弦", tex`\sin`], ["cosine", "cos 余弦", tex`\cos`],
    ["tangent", "tan 正切", tex`\tan`], ["cotangent", "cot 余切", tex`\cot`],
    ["secant", "sec 正割", tex`\sec`], ["cosecant", "csc 余割", tex`\csc`],
    ["arcsine", "arcsin 反正弦", tex`\arcsin`], ["arccosine", "arccos 反余弦", tex`\arccos`],
    ["arctangent", "arctan 反正切", tex`\arctan`], ["hyperbolicSine", "sinh 双曲正弦", tex`\sinh`],
    ["hyperbolicCosine", "cosh 双曲余弦", tex`\cosh`], ["hyperbolicTangent", "tanh 双曲正切", tex`\tanh`],
    ["hyperbolicCotangent", "coth 双曲余切", tex`\coth`], ["naturalLog", "ln 自然对数", tex`\ln`],
    ["logarithm", "log 对数", tex`\log`], ["decimalLog", "lg 常用对数", tex`\lg`],
    ["exponential", "exp 指数函数", tex`\exp`], ["signum", "sgn 符号函数", tex`\operatorname{sgn}`],
    ["determinant", "det 行列式", tex`\det`], ["rank", "rank 秩", tex`\operatorname{rank}`],
    ["diagonal", "diag 对角", tex`\operatorname{diag}`], ["dimension", "dim 维数", tex`\dim`],
    ["kernel", "ker 核", tex`\ker`], ["span", "span 张成", tex`\operatorname{span}`],
    ["realPart", "Re 实部", tex`\operatorname{Re}`], ["imaginaryPart", "Im 虚部", tex`\operatorname{Im}`],
    ["argument", "arg 辐角", tex`\arg`], ["gcd", "gcd 最大公约数", tex`\gcd`],
    ["modulo", "mod 模运算", tex`\bmod`],
    ["supremum", "sup 上确界", tex`\sup`], ["argMin", "arg min 极小点", tex`\operatorname*{arg\,min}`],
    ["argMax", "arg max 极大点", tex`\operatorname*{arg\,max}`],
  ] },
  { label: "微积", keys: [
    ["product", "∏ 连乘", tex`\prod`], ["coproduct", "∐ 余积", tex`\coprod`],
    ["doubleIntegral", "∬ 二重积分", tex`\iint`], ["tripleIntegral", "∭ 三重积分", tex`\iiint`],
    ["contourIntegral", "∮ 围道积分", tex`\oint`], ["surfaceIntegral", "∯ 曲面积分", tex`\oiint`],
    ["volumeIntegral", "∰ 体积分", tex`\oiiint`], ["partial", "∂ 偏微分", tex`\partial`],
    ["nabla", "∇ 梯度", tex`\nabla`], ["limit", "lim 极限", tex`\lim`],
    ["limitSup", "lim sup 上极限", tex`\limsup`], ["limitInf", "lim inf 下极限", tex`\liminf`],
  ] },
  { label: "箭头", keys: [
    ["leftArrow", "← 左箭头", tex`\leftarrow`], ["leftRightArrow", "↔ 双向箭头", tex`\leftrightarrow`],
    ["leftDoubleArrow", "⇐ 反向推出", tex`\Leftarrow`], ["upArrow", "↑ 上箭头", tex`\uparrow`],
    ["downArrow", "↓ 下箭头", tex`\downarrow`], ["upDownArrow", "↕ 上下箭头", tex`\updownarrow`],
    ["mapsto", "↦ 映射到", tex`\mapsto`], ["longMapsto", "⟼ 长映射", tex`\longmapsto`],
    ["longRightArrow", "⟶ 长右箭头", tex`\longrightarrow`], ["longLeftArrow", "⟵ 长左箭头", tex`\longleftarrow`],
    ["longLeftRightArrow", "⟷ 长双向箭头", tex`\longleftrightarrow`],
    ["hookRightArrow", "↪ 右钩箭头", tex`\hookrightarrow`], ["hookLeftArrow", "↩ 左钩箭头", tex`\hookleftarrow`],
    ["rightHarpoonUp", "⇀ 右上鱼叉", tex`\rightharpoonup`], ["rightHarpoonDown", "⇁ 右下鱼叉", tex`\rightharpoondown`],
    ["leftHarpoonUp", "↼ 左上鱼叉", tex`\leftharpoonup`], ["leftHarpoonDown", "↽ 左下鱼叉", tex`\leftharpoondown`],
    ["rightLeftHarpoons", "⇌ 平衡箭头", tex`\rightleftharpoons`], ["twoHeadRightArrow", "↠ 双头右箭头", tex`\twoheadrightarrow`],
    ["northEastArrow", "↗ 右上箭头", tex`\nearrow`], ["southEastArrow", "↘ 右下箭头", tex`\searrow`],
    ["northWestArrow", "↖ 左上箭头", tex`\nwarrow`], ["southWestArrow", "↙ 左下箭头", tex`\swarrow`],
  ] },
  { label: "希腊", keys: [
    ["alpha", "α alpha", tex`\alpha`], ["beta", "β beta", tex`\beta`],
    ["gamma", "γ gamma", tex`\gamma`], ["delta", "δ delta", tex`\delta`],
    ["epsilon", "ϵ epsilon", tex`\epsilon`], ["varepsilon", "ε varepsilon", tex`\varepsilon`],
    ["zeta", "ζ zeta", tex`\zeta`], ["eta", "η eta", tex`\eta`],
    ["theta", "θ theta", tex`\theta`], ["vartheta", "ϑ vartheta", tex`\vartheta`],
    ["iota", "ι iota", tex`\iota`], ["kappa", "κ kappa", tex`\kappa`],
    ["lambda", "λ lambda", tex`\lambda`], ["mu", "μ mu", tex`\mu`],
    ["nu", "ν nu", tex`\nu`], ["xi", "ξ xi", tex`\xi`],
    ["omicron", "ο omicron", tex`\omicron`], ["pi", "π pi", tex`\pi`],
    ["varpi", "ϖ varpi", tex`\varpi`], ["rho", "ρ rho", tex`\rho`],
    ["varrho", "ϱ varrho", tex`\varrho`], ["sigma", "σ sigma", tex`\sigma`],
    ["varsigma", "ς varsigma", tex`\varsigma`], ["tau", "τ tau", tex`\tau`],
    ["upsilon", "υ upsilon", tex`\upsilon`], ["phi", "ϕ phi", tex`\phi`],
    ["varphi", "φ varphi", tex`\varphi`], ["chi", "χ chi", tex`\chi`],
    ["psi", "ψ psi", tex`\psi`], ["omega", "ω omega", tex`\omega`],
    ["Gamma", "Γ Gamma", tex`\Gamma`], ["Delta", "Δ Delta", tex`\Delta`],
    ["Theta", "Θ Theta", tex`\Theta`], ["Lambda", "Λ Lambda", tex`\Lambda`],
    ["Xi", "Ξ Xi", tex`\Xi`], ["Pi", "Π Pi", tex`\Pi`],
    ["Sigma", "Σ Sigma", tex`\Sigma`], ["Upsilon", "Υ Upsilon", tex`\Upsilon`],
    ["Phi", "Φ Phi", tex`\Phi`], ["Psi", "Ψ Psi", tex`\Psi`],
    ["Omega", "Ω Omega", tex`\Omega`],
  ] },
  { label: "常数", keys: [
    ["three", "3 常数", "3"], ["four", "4 常数", "4"], ["five", "5 常数", "5"],
    ["six", "6 常数", "6"], ["seven", "7 常数", "7"], ["eight", "8 常数", "8"], ["nine", "9 常数", "9"],
    ["decimalPoint", ". 小数点", "."], ["infinity", "∞ 无穷大", tex`\infty`],
    ["eulerNumber", "e 自然常数", tex`\mathrm{e}`], ["imaginaryUnit", "i 虚数单位", tex`\mathrm{i}`],
    ["aleph", "ℵ 阿列夫", tex`\aleph`], ["hbar", "ℏ 约化普朗克常数", tex`\hbar`],
    ["ell", "ℓ 花体 l", tex`\ell`], ["percent", "% 百分号", tex`\%`],
  ] },
  { label: "修饰", keys: [
    ["hatAccent", "帽子修饰", formulaGroupedOperators.hatAccent],
    ["wideHatAccent", "宽帽子修饰", formulaGroupedOperators.wideHatAccent],
    ["barAccent", "短横线修饰", formulaGroupedOperators.barAccent],
    ["overlineAccent", "上横线", formulaGroupedOperators.overlineAccent],
    ["underlineAccent", "下横线", formulaGroupedOperators.underlineAccent],
    ["vectorAccent", "向量箭头", formulaGroupedOperators.vectorAccent],
    ["tildeAccent", "波浪修饰", formulaGroupedOperators.tildeAccent],
    ["wideTildeAccent", "宽波浪修饰", formulaGroupedOperators.wideTildeAccent],
    ["doubleDotAccent", "二阶点导数", formulaGroupedOperators.doubleDotAccent],
    ["overbraceAccent", "上花括号注释", formulaGroupedOperators.overbraceAccent],
    ["underbraceAccent", "下花括号注释", formulaGroupedOperators.underbraceAccent],
    ["cancelAccent", "删除线", formulaGroupedOperators.cancelAccent],
    ["boxedAccent", "方框标注", formulaGroupedOperators.boxedAccent],
  ] },
  { label: "矩阵", keys: [
    ["matrix2x2", "2×2 矩阵", tex`\begin{pmatrix}0&0\\0&0\end{pmatrix}`],
    ["matrix3x3", "3×3 矩阵", tex`\begin{bmatrix}0&0&0\\0&0&0\\0&0&0\end{bmatrix}`],
    ["identityMatrix", "单位矩阵", tex`\begin{pmatrix}1&0\\0&1\end{pmatrix}`],
    ["columnVector", "列向量", tex`\begin{pmatrix}0\\0\end{pmatrix}`],
    ["rowVector", "行向量", tex`\begin{pmatrix}0&0\end{pmatrix}`],
  ] },
  { label: "标点", keys: [
    ["centerDots", "⋯ 居中省略", tex`\cdots`], ["verticalDots", "⋮ 竖直省略", tex`\vdots`],
    ["diagonalDots", "⋱ 对角省略", tex`\ddots`], ["prime", "′ 撇号", tex`\prime`],
    ["doublePrime", "″ 双撇号", tex`\prime\prime`], ["degree", "° 度数", tex`{}^{\circ}`],
    ["thinSpace", "窄间距", tex`\,`], ["mediumSpace", "中间距", tex`\:`],
    ["thickSpace", "宽间距", tex`\;`], ["doubleSpace", "双间距", tex`\qquad`],
    ["negativeSpace", "负间距", tex`\!`],
  ] },
] as const;

const closingOperators = [
  ["floorClose", "向下取整结束", tex`\right\rfloor`],
  ["ceilClose", "向上取整结束", tex`\right\rceil`],
  ["angleClose", "尖括号结束", tex`\right\rangle`],
] as const;

export type AdditionalFormulaOperator =
  | (typeof additionalFormulaOperatorGroups)[number]["keys"][number][0]
  | (typeof closingOperators)[number][0];

export const additionalFormulaOperators = [
  ...additionalFormulaOperatorGroups.flatMap(group => group.keys.map(key => ({ id: key[0], label: key[1], tex: key[2] }))),
  ...closingOperators.map(key => ({ id: key[0], label: key[1], tex: key[2] })),
];

export const formulaLargeOperators = new Set<string>([
  "sum", "integral", "infimum", "minimum", "maximum", "product", "coproduct", "doubleIntegral", "tripleIntegral",
  "contourIntegral", "surfaceIntegral", "volumeIntegral", "limit", "limitSup", "limitInf", "supremum",
  "argMin", "argMax", "bigUnion", "bigIntersection", "bigDirectSum", "bigTensorProduct", "bigLogicalAnd", "bigLogicalOr",
]);
