# 원본 배포본 (vendor originals)

여기 있는 zip은 **내려받은 그대로의 서드파티 애드인**입니다. 풀어서 쓰라고 둔 게
아니라, 옆 폴더의 사본이 원본과 같은지 확인할 수 있게 남겨둔 것입니다.

| zip | 대응 폴더 |
|---|---|
| `CycloidalGearGenerator-original.zip` | `../CycloidalGearGenerator/` |
| `UniversalGearGenerator_v2_fixed-original.zip` | `../UniversalGearGenerator/` |

이 두 애드인은 직접 만든 것이 아니라 가져다 쓰는 것이라, 손대지 않는 것이
원칙입니다. `../HarmonicDriveGenerator/`만 이 저장소에서 개발합니다.

원본과 달라진 게 없는지 확인하려면:

```bash
cd fusion360_addin/vendor-originals
unzip -o CycloidalGearGenerator-original.zip -d /tmp/orig-cyclo
diff -r /tmp/orig-cyclo ../CycloidalGearGenerator
```
