# IDAF/AC - Multas e Taxas (PWA offline)

**Autor:** Vander da Rocha Melo

App estatico (HTML/CSS/JS puro, sem build, sem backend) para calcular multas, taxas,
emolumentos e valores de GTA do Decreto 11.368/2023 (defesa sanitaria animal do Acre),
e ajudar a redigir a descricao da infracao. O app **nao sugere enquadramento** — o
servidor escolhe a infracao; o app apenas calcula e monta o texto.

Toda a informacao legal (valores, descricoes, previsao legal, URF) vem do arquivo
[`data/idaf_infracoes.json`](data/idaf_infracoes.json), que e a fonte unica de verdade.
Nada e hardcoded no `app.js`.

## Estrutura

```
index.html              tela e as 4 abas (multas, taxas, GTA, busca)
styles.css              estilos mobile-first, alto contraste
app.js                  toda a logica (le o JSON, calcula, monta textos)
manifest.json           metadados do PWA (nome, icones, modo standalone)
service-worker.js       cache offline (CACHE_VERSION controla a atualizacao)
data/idaf_infracoes.json  base de dados legal (fonte unica de verdade)
icons/                  icones do PWA (192, 512 e 512 maskable)
```

## Como atualizar a URF/AC todo ano

1. Abra `data/idaf_infracoes.json`.
2. Edite apenas o bloco `meta.urf_ac`:
   - `valor_reais`: novo valor em R$ da URF/AC.
   - `exercicio`: ano de vigencia.
   - `fonte` e `vigencia`: referencia da portaria da SEFAZ.
3. Abra `service-worker.js` e incremente `CACHE_VERSION` (ex.: `"v1"` -> `"v2"`).
   Isso forca o navegador a baixar a nova versao do app e do JSON na proxima
   vez que o usuario abrir com internet, mesmo que ja tenha instalado o PWA.
4. Publique a nova versao (veja abaixo).

Se o proprio Decreto 11.368/2023 for alterado (novos valores, novas infracoes,
mudanca no piso, na reincidencia ou no limite de advertencia), edite a secao
correspondente do mesmo JSON (`infracoes_por_cabeca`, `infracoes_valor_fixo`,
`taxas_emolumentos`, `tabela_gta_anexo_iii`, `meta.regras_transversais` etc.) e
tambem incremente o `CACHE_VERSION`.

## Como publicar no GitHub Pages

1. Crie um repositorio no GitHub e suba todos os arquivos desta pasta
   (`index.html`, `styles.css`, `app.js`, `manifest.json`, `service-worker.js`,
   `data/`, `icons/`) na raiz do repositorio (ou em `/docs`, se preferir).
2. No GitHub, va em **Settings > Pages**.
3. Em **Source**, selecione a branch (`main`) e a pasta (`/root` ou `/docs`).
4. Salve. O GitHub gera uma URL do tipo
   `https://<seu-usuario>.github.io/<repositorio>/`.
5. Toda vez que voce alterar o JSON ou qualquer arquivo, basta commitar e
   subir (`git push`) — o GitHub Pages atualiza automaticamente em alguns
   minutos. Lembre-se de subir o `CACHE_VERSION` para que quem ja instalou
   o app no celular receba a atualizacao.

## Uso offline

Na primeira visita (com internet), o `service-worker.js` guarda em cache todos
os arquivos do app, incluindo o JSON de dados. Depois disso, o app funciona
inteiramente offline — inclusive apos ser instalado ("Adicionar a tela inicial")
no celular. Nenhum dado do usuario e enviado a servidor nenhum: nao ha
formularios de cadastro, login ou envio de informacoes.
