# Pachecode Web

Leitor web/PWA estatico do Pachecode. A aplicacao processa os QR Codes no
navegador e nao inclui o emissor Python, testes internos ou historico do
repositorio privado.

Depois de receber o primeiro QR Code, o leitor mostra os numeros dos blocos
pendentes e permite copia-los para recuperacao seletiva no emissor. A lista usa
a sessao local do protocolo v1 e e atualizada a cada captura, sem upload.

O conteudo servido pelo GitHub Pages fica em `site/`. Os demais arquivos deste
repositorio existem apenas para validar e publicar essa pasta.

Antes de cada atualizacao, gere uma nova entrega a partir do repositorio privado
e revise a lista de arquivos. Nao copie o repositorio privado nem sua pasta
`.git` para este repositorio.
