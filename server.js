const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Groq } = require('groq-sdk');

// Carrega variáveis de ambiente
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializa o SDK da Groq
const groqApiKey = process.env.api_groq || process.env.GROQ_API_KEY;
let groq = null;
if (groqApiKey) {
  console.log('Chave API do Groq detectada no arquivo .env.');
  groq = new Groq({ apiKey: groqApiKey });
} else {
  console.warn('AVISO: api_groq não configurada no arquivo .env. O TupiDesk funcionará com analisadores locais mockados.');
}

// Inicialização da chave da Brevo
const brevoKey = process.env.brevo;
if (brevoKey) {
  console.log('Chave API da Brevo detectada no arquivo .env.');
} else {
  console.warn('AVISO: brevo não configurada no arquivo .env. Envio de e-mails via Brevo desativado.');
}

const TICKETS_FILE = path.join(__dirname, 'tickets.json');
const KB_FILE = path.join(__dirname, 'knowledge_base.json');

// --- Métricas de Similaridade (Múltiplas Métricas) ---

// 1. Distância de Levenshtein (Distância de Edição)
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // Deletar
          dp[i][j - 1] + 1,    // Inserir
          dp[i - 1][j - 1] + 1 // Substituir
        );
      }
    }
  }
  return dp[m][n];
}

// Retorna uma pontuação de 0 a 1 para similaridade Levenshtein
function levenshteinSimilarity(s1, s2) {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(s1, s2) / maxLen;
}

// 2. Similaridade de Jaccard (Baseada em Conjuntos de Tokens)
function jaccardSimilarity(s1, s2) {
  const tokens1 = new Set(s1.toLowerCase().match(/\b\w+\b/g) || []);
  const tokens2 = new Set(s2.toLowerCase().match(/\b\w+\b/g) || []);

  if (tokens1.size === 0 && tokens2.size === 0) return 1.0;

  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

// --- Funções Auxiliares de Dados ---

function readJSONFile(filePath, defaultData = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf-8');
      return defaultData;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Erro ao ler arquivo ${filePath}:`, error);
    return defaultData;
  }
}

function writeJSONFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Erro ao escrever no arquivo ${filePath}:`, error);
  }
}

// Função para envio de e-mail usando a API da Brevo via HTTPS (Porta 443)
// Função para envio de e-mail usando a API da Brevo via HTTPS (Porta 443)
function sendTicketResolvedEmail(ticket) {
  return new Promise((resolve, reject) => {
    const brevoApiKey = process.env.brevo;
    const gmailUser = process.env.gmail_user; // E-mail cadastrado como remetente no Brevo
    
    if (!brevoApiKey) {
      console.log(`[Brevo API] E-mail não enviado para ${ticket.clientEmail}: chave de API do Brevo ausente.`);
      return resolve();
    }

    const senderEmail = gmailUser || 'bruno.vollu@gmail.com';

    const agentComments = ticket.comments.filter(c => c.sender === 'agent');
    let agentReplyHtml = '';
    if (agentComments.length > 0) {
      const lastReply = agentComments[agentComments.length - 1].text;
      agentReplyHtml = `
        <div style="border-left: 4px solid #10b981; padding-left: 15px; margin: 20px 0;">
          <p style="margin: 0 0 5px 0; font-size: 14px; color: #10b981;"><strong>Solução do Atendente:</strong></p>
          <p style="margin: 0; font-style: italic; white-space: pre-wrap; color: #f3f4f6;">${lastReply}</p>
        </div>
      `;
    }

    const emailBody = JSON.stringify({
      sender: { name: "Suporte TupiDesk", email: senderEmail },
      to: [ { email: ticket.clientEmail, name: ticket.clientName } ],
      subject: `[TupiDesk] Chamado Resolvido: ${ticket.id} - ${ticket.aiAnalysis.summary}`,
      htmlContent: `
        <div style="font-family: sans-serif; background-color: #0d0f14; color: #f3f4f6; padding: 25px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #1f2937;">
          <div style="text-align: center; border-bottom: 1px solid #1f2937; padding-bottom: 15px; margin-bottom: 20px;">
            <h2 style="color: #3b82f6; font-size: 24px; margin: 0;">TupiDesk</h2>
            <span style="font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Notificação de Encerramento</span>
          </div>
          <p>Olá <strong>${ticket.clientName}</strong>,</p>
          <p>Seu chamado de suporte foi concluído com sucesso e marcado como <strong>Resolvido</strong>.</p>
          
          <div style="background-color: #121620; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #1f2937;">
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #9ca3af; text-transform: uppercase;"><strong>Detalhes do Chamado:</strong></p>
            <p style="margin: 0 0 5px 0;"><strong>ID:</strong> ${ticket.id}</p>
            <p style="margin: 0 0 5px 0;"><strong>Resumo:</strong> ${ticket.aiAnalysis.summary}</p>
            <p style="margin: 0;"><strong>Descrição:</strong> ${ticket.description}</p>
          </div>
          
          ${agentReplyHtml}
          
          <hr style="border: 0; border-top: 1px solid #1f2937; margin: 25px 0;" />
          <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0;">Este é um e-mail automático enviado pelo TupiDesk. Por favor, não responda diretamente a esta mensagem.</p>
        </div>
      `
    });

    const https = require('https');
    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': brevoApiKey,
        'content-length': Buffer.byteLength(emailBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 201 || res.statusCode === 200) {
            console.log(`[Brevo API] E-mail enviado com sucesso! MessageID: ${parsed.messageId}`);
            resolve(parsed);
          } else {
            console.error(`[Brevo API] Erro ao enviar e-mail (Status ${res.statusCode}):`, parsed);
            resolve(parsed);
          }
        } catch (e) {
          console.error(`[Brevo API] Falha ao parsear resposta:`, data);
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Brevo API] Erro de rede:`, err);
      reject(err);
    });

    req.write(emailBody);
    req.end();
  });
}

// Garante que o arquivo de tickets e KB existam
const knowledgeBase = readJSONFile(KB_FILE);
let tickets = readJSONFile(TICKETS_FILE);

// Se o arquivo de tickets estiver vazio, cria alguns mocks bonitos
if (tickets.length === 0) {
  tickets = [
    {
      id: "TICK-4567",
      clientName: "Mardonio",
      clientEmail: "mardonio@gmail.com",
      description: "Estou com dificuldades de achar meu pedaço de bolo",
      status: "novo",
      createdAt: new Date().toISOString(),
      aiAnalysis: {
        summary: "Dificuldade de encontrar bolo",
        sentiment: "Frustrado",
        urgency: "Baixo",
        category: "Dúvidas",
        jaccardScore: 0.06,
        levenshteinScore: 0.25,
        matchedArticleId: "KB004"
      },
      suggestedResponse: "Olá Mardonio,\n\nObrigado por contar conosco sobre seus problemas em encontrar seu pedaço de bolo. No entanto, infelizmente, não parece que o problema esteja relacionado às nossas configurações de e-mail.\n\nMas para ajudar com as configurações de e-mail, se você está tendo dificuldades para configurar sua conta de e-mail ou se seus e-mails estão caindo na caixa de SPAM do destinatário, podemos sugerir algumas soluções. A configuração padrão de e-mail para nossa plataforma é:\n\n- SMTP na porta 587 com TLS ativado\n- Servidor de saída: mail.tupidesk.com\n\nAlém disso, certifique-se de que os registros SPF, DKIM e DMARC do domínio do seu e-mail estão corretamente configurados na zona de DNS. Isso pode ajudar a evitar que seus e-mails sejam filtrados como SPAM.\n\nSe você precisar de ajuda com a configuração desses registros ou se tiver alguma outra dúvida sobre suas configurações de e-mail, ficaremos felizes em ajudar.\n\nAtenciosamente,\nSuporte TupiDesk",
      comments: [
        { sender: "client", text: "Estou com dificuldades de achar meu pedaço de bolo", createdAt: new Date().toISOString() }
      ]
    }
  ];
  writeJSONFile(TICKETS_FILE, tickets);
}

// --- Lógica de Negócio: Triagem Local (Fallback) ---
function localAnalyzeTicket(description) {
  const textLower = description.toLowerCase();
  
  // Categorização rudimentar
  let category = "Dúvidas";
  if (textLower.includes("senha") || textLower.includes("login") || textLower.includes("bloque") || textLower.includes("acesso") || textLower.includes("entrar")) {
    category = "Acesso";
  } else if (textLower.includes("pagamento") || textLower.includes("boleto") || textLower.includes("fatura") || textLower.includes("cobranca") || textLower.includes("cartao") || textLower.includes("financeiro")) {
    category = "Financeiro";
  } else if (textLower.includes("erro") || textLower.includes("bug") || textLower.includes("quebro") || textLower.includes("tela preta")) {
    category = "Bugs";
  } else if (textLower.includes("servidor") || textLower.includes("lento") || textLower.includes("queda") || textLower.includes("fora do ar") || textLower.includes("offline")) {
    category = "Infraestrutura";
  }

  // Urgência rudimentar
  let urgency = "Médio";
  if (textLower.includes("urgente") || textLower.includes("fora do ar") || textLower.includes("fora") || textLower.includes("parado") || textLower.includes("critico") || textLower.includes("bloqueado") || textLower.includes("seguranca")) {
    urgency = "Alto";
  }
  if (textLower.includes("502") || textLower.includes("500") || textLower.includes("prejuizo") || textLower.includes("urgente!") || textLower.includes("socorro")) {
    urgency = "Crítico";
  }
  if (textLower.includes("duvida") || textLower.includes("gostaria de saber") || textLower.includes("como faco")) {
    urgency = "Baixo";
  }

  // Sentimento rudimentar
  let sentiment = "Neutro";
  if (textLower.includes("ruim") || textLower.includes("pessimo") || textLower.includes("irritado") || textLower.includes("absurdo") || textLower.includes("preciso urgente") || textLower.includes("parado")) {
    sentiment = "Frustrado";
  } else if (textLower.includes("obrigado") || textLower.includes("agradeco") || textLower.includes("por favor")) {
    sentiment = "Satisfeito";
  }

  // Resumo curto
  const words = description.split(' ').slice(0, 5).join(' ');
  const summary = `${words}...`;

  return { summary, sentiment, urgency, category };
}

// --- Endpoints da API ---

// 1. Obter todos os chamados
app.get('/api/tickets', (req, res) => {
  res.json(tickets);
});

// 2. Obter base de conhecimento
app.get('/api/kb', (req, res) => {
  res.json(knowledgeBase);
});

// 3. Criar um novo chamado com análise da IA (ou local fallback)
app.post('/api/tickets', async (req, res) => {
  const { clientName, clientEmail, description } = req.body;

  if (!clientName || !clientEmail || !description) {
    return res.status(400).json({ error: "Campos clientName, clientEmail e description são obrigatórios." });
  }

  const ticketId = `TICK-${Math.floor(1000 + Math.random() * 9000)}`;
  
  let analysis = {
    summary: "",
    sentiment: "Neutro",
    urgency: "Médio",
    category: "Dúvidas"
  };

  // --- Abordagem Bottom-Up: Processamento Atômico ---
  
  // A. IA Triagem (Urgency, Sentiment, Category, Summary)
  if (groq) {
    try {
      const prompt = `Analise a seguinte descrição de chamado de suporte técnico e forneça um JSON com a classificação.
Descrição do chamado: "${description}"

Campos que o JSON DEVE conter:
- "summary": Um resumo curto do problema em até 6 palavras.
- "sentiment": O sentimento do cliente (deve ser um de: "Frustrado", "Neutro", "Satisfeito").
- "urgency": A urgência do problema (deve ser um de: "Baixo", "Médio", "Alto", "Crítico").
- "category": A categoria técnica (deve ser um de: "Acesso", "Financeiro", "Bugs", "Infraestrutura", "Dúvidas").

Retorne APENAS o JSON válido sem explicações ou blocos adicionais.`;

      const response = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-8b-instant",
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content);
      analysis.summary = result.summary || description.substring(0, 30);
      analysis.sentiment = result.sentiment || "Neutro";
      analysis.urgency = result.urgency || "Médio";
      analysis.category = result.category || "Dúvidas";
      console.log(`IA análise para ${ticketId} concluída:`, analysis);
    } catch (err) {
      console.error(`Erro ao chamar a API da Groq para análise. Usando triagem local.`, err);
      analysis = localAnalyzeTicket(description);
    }
  } else {
    analysis = localAnalyzeTicket(description);
  }

  // B. Busca por Similaridade na Base de Conhecimento (Feature 1 & Feature 2)
  let bestArticle = null;
  let highestJaccard = 0;
  let highestLevenshtein = 0;

  knowledgeBase.forEach(article => {
    // Calcula Jaccard entre as keywords do artigo e as palavras da descrição
    const keywordsStr = article.keywords.join(" ");
    const jaccard = jaccardSimilarity(description, keywordsStr);

    // Calcula Levenshtein normalizado comparando as palavras da descrição com as palavras-chave
    // Para Levenshtein fazer sentido em textos de tamanhos muito diferentes,
    // podemos comparar a descrição com o título do artigo
    const levenshtein = levenshteinSimilarity(description, article.title);

    // Pontuação combinada (ponderada) para definir o melhor artigo
    // Jaccard funciona muito bem para palavras chave. Levenshtein ajuda se houver erros de grafia próximos.
    const score = (jaccard * 0.7) + (levenshtein * 0.3);
    
    // Queremos encontrar o artigo mais relevante
    const currentBestScore = (highestJaccard * 0.7) + (highestLevenshtein * 0.3);
    if (score > currentBestScore || bestArticle === null) {
      bestArticle = article;
      highestJaccard = jaccard;
      highestLevenshtein = levenshtein;
    }
  });

  // Salva os scores de similaridade na análise
  analysis.jaccardScore = parseFloat(highestJaccard.toFixed(2));
  analysis.levenshteinScore = parseFloat(highestLevenshtein.toFixed(2));
  analysis.matchedArticleId = bestArticle ? bestArticle.id : null;

  // C. Gerar sugestão de resposta usando o artigo encontrado da KB
  let suggestedResponse = "Olá! Recebemos seu chamado e em breve um atendente irá entrar em contato.";
  
  if (bestArticle) {
    if (groq) {
      try {
        const replyPrompt = `Você é o assistente inteligente de suporte técnico TupiDesk. 
Um cliente chamado "${clientName}" abriu o seguinte chamado:
"${description}"

Com base na busca de similaridade, o artigo da base de conhecimento mais relevante encontrado foi:
Título: "${bestArticle.title}"
Conteúdo Resolutivo: "${bestArticle.content}"

Escreva uma resposta profissional de suporte recomendando educadamente a solução descrita no artigo.
Personalize a mensagem chamando o cliente pelo nome. Assine como "Suporte TupiDesk".
A resposta deve ser útil, acolhedora e focar estritamente no problema relatado.`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: replyPrompt }],
          model: "llama-3.1-8b-instant"
        });

        suggestedResponse = response.choices[0].message.content.trim();
        console.log(`IA resposta sugerida para ${ticketId} criada.`);
      } catch (err) {
        console.error("Erro ao gerar sugestão de resposta via Groq:", err);
        // Fallback local simples baseada no artigo
        suggestedResponse = `Olá ${clientName},\n\nIdentificamos o seu problema sobre "${analysis.summary}". Com base na nossa base de conhecimento (Artigo: ${bestArticle.title}), sugerimos o seguinte procedimento:\n\n${bestArticle.content}\n\nEsperamos que isso ajude. Caso persista, nossa equipe de suporte entrará em contato.\n\nAtenciosamente,\nSuporte TupiDesk`;
      }
    } else {
      suggestedResponse = `Olá ${clientName},\n\nIdentificamos o seu problema sobre "${analysis.summary}". Com base na nossa base de conhecimento (Artigo: ${bestArticle.title}), sugerimos o seguinte procedimento:\n\n${bestArticle.content}\n\nEsperamos que isso ajude. Caso persista, nossa equipe de suporte entrará em contato.\n\nAtenciosamente,\nSuporte TupiDesk`;
    }
  }

  // Criação do objeto ticket final
  const newTicket = {
    id: ticketId,
    clientName,
    clientEmail,
    description,
    status: "novo",
    createdAt: new Date().toISOString(),
    aiAnalysis: analysis,
    suggestedResponse,
    comments: [
      { sender: "client", text: description, createdAt: new Date().toISOString() }
    ]
  };

  tickets.push(newTicket);
  writeJSONFile(TICKETS_FILE, tickets);

  res.status(201).json(newTicket);
});

// 4. Atualizar status de um chamado (Roteamento / Kanban)
app.put('/api/tickets/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["novo", "em_progresso", "resolvido"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Deve ser um de: ${validStatuses.join(", ")}` });
  }

  const ticketIndex = tickets.findIndex(t => t.id === id);
  if (ticketIndex === -1) {
    return res.status(404).json({ error: "Chamado não encontrado." });
  }

  const oldStatus = tickets[ticketIndex].status;
  tickets[ticketIndex].status = status;
  writeJSONFile(TICKETS_FILE, tickets);

  // Se o status mudou para resolvido, envia o e-mail de finalização
  if (status === "resolvido" && oldStatus !== "resolvido") {
    sendTicketResolvedEmail(tickets[ticketIndex]).catch(err => console.error("Erro ao enviar e-mail:", err));
  }

  res.json(tickets[ticketIndex]);
});

// 5. Adicionar comentário ou resposta do atendente
app.post('/api/tickets/:id/comments', (req, res) => {
  const { id } = req.params;
  const { sender, text } = req.body;

  if (!sender || !text) {
    return res.status(400).json({ error: "Campos sender e text são obrigatórios." });
  }

  const ticketIndex = tickets.findIndex(t => t.id === id);
  if (ticketIndex === -1) {
    return res.status(404).json({ error: "Chamado não encontrado." });
  }

  const newComment = {
    sender,
    text,
    createdAt: new Date().toISOString()
  };

  tickets[ticketIndex].comments.push(newComment);
  
  // Se o atendente respondeu, opcionalmente coloca em progresso ou resolvido dependendo da ação
  if (sender === "agent" && tickets[ticketIndex].status === "novo") {
    tickets[ticketIndex].status = "em_progresso";
  }

  writeJSONFile(TICKETS_FILE, tickets);
  res.status(201).json(tickets[ticketIndex]);
});

// 6. Conversar com a IA sobre o chamado (Agent Helper Chat)
app.post('/api/tickets/:id/ai-chat', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Campo message é obrigatório." });
  }

  const ticket = tickets.find(t => t.id === id);
  if (!ticket) {
    return res.status(404).json({ error: "Chamado não encontrado." });
  }

  if (!groq) {
    return res.json({
      reply: "IA não está ativa (chave ausente no arquivo .env). Para conversar com a IA, certifique-se de configurar api_groq corretamente."
    });
  }

  try {
    const chatPrompt = `Você é o assistente inteligente TupiDesk. 
Estamos discutindo o chamado de suporte do cliente "${ticket.clientName}" (${ticket.clientEmail}) sobre o problema:
"${ticket.description}"

Informações adicionais do chamado:
- Categoria: ${ticket.aiAnalysis.category}
- Sentimento: ${ticket.aiAnalysis.sentiment}
- Urgência: ${ticket.aiAnalysis.urgency}
- Status Atual: ${ticket.status}

O atendente enviou a seguinte mensagem para você ajudar a responder ou analisar:
"${message}"

Forneça orientações técnicas, sugestões de diagnóstico ou esboços de respostas que ajudem o atendente a resolver esse caso da melhor forma.`;

    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: chatPrompt }],
      model: "llama-3.1-8b-instant"
    });

    res.json({ reply: response.choices[0].message.content.trim() });
  } catch (err) {
    console.error("Erro no chat do atendente com a IA:", err);
    res.status(500).json({ error: "Erro interno ao processar conversa com a IA." });
  }
});

app.get('/api/test-email', async (req, res) => {
  const toEmail = req.query.email || 'dibu695@gmail.com';
  console.log(`[Teste API] Iniciando disparo de e-mail de teste para: ${toEmail}`);
  
  const brevoApiKey = process.env.brevo;
  if (brevoApiKey) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(brevoApiKey).digest('hex');
    console.log(`[DEBUG] Brevo key length: ${brevoApiKey.length}`);
    console.log(`[DEBUG] Brevo key start: ${brevoApiKey.substring(0, 15)}...`);
    console.log(`[DEBUG] Brevo key end: ...${brevoApiKey.substring(brevoApiKey.length - 15)}`);
    console.log(`[DEBUG] Brevo key sha256: ${hash}`);
  } else {
    console.log(`[DEBUG] Brevo key is undefined/null!`);
  }
  
  const mockTicket = {
    id: "TICK-TEST-1234",
    clientName: "Cliente de Teste",
    clientEmail: toEmail,
    description: "Este é um teste direto de envio de e-mails para validar a integração do Brevo API.",
    aiAnalysis: {
      summary: "Teste de Integração de E-mail"
    },
    comments: [
      { sender: "agent", text: "Parabéns! A integração de e-mail do TupiDesk via Brevo API foi concluída e está funcionando 100% no Render!" }
    ]
  };

  try {
    await sendTicketResolvedEmail(mockTicket);
    res.json({
      status: "success",
      message: `Tentativa de envio de e-mail concluída para ${toEmail}. Verifique os logs do console do servidor para confirmar o MessageID ou possíveis erros.`
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`=== Servidor TupiDesk rodando com sucesso ===`);
  console.log(`URL Local: http://localhost:${PORT}`);
});
