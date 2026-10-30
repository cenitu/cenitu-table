# Katkı rehberi

Katkılarınız memnuniyetle karşılanır. Hata bildirimi ve öneriler için bir issue açın; kod
değişiklikleri için pull request gönderin.

## Geliştirme

```bash
npm install
npm run dev     # demo: http://localhost:5180
npm test        # vitest
npm run build   # tip denetimi + paket + .d.ts
```

Pull request göndermeden önce `npm run build` ve `npm test` başarılı olmalı. Davranış değiştiren
her değişiklik bir test ile gelmeli.

## Clean-room kuralı

CenituTable bağımsız bir implementasyondur. Başka bir grid veya formül motoru projesinin kaynak
kodunu kopyalamayın, çevirmeyin ya da ondan uyarlamayın. Davranışı public dokümantasyondan,
spreadsheet bilgisinden ve testlerden çıkarın. Lisansı uyumsuz kod içeren katkılar kabul edilemez.

## Kod stili

- TypeScript `strict`; çalışma zamanı bağımlılığı eklemeyin.
- Mevcut koda benzeyin: küçük modüller, yalnızca "neden"i açıklayan kısa yorumlar.
- Katkılarınız [MIT lisansı](LICENSE) altında yayımlanır.
