import { GoogleGenerativeAI } from '@google/generative-ai';

// Multiple API keys for rotation to avoid rate limits
// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// Multiple API keys for round-robin usage
const API_KEYS = [
  'sk-790c2915854b493abd4e8e8d38318f04',
  import.meta.env.VITE_GEMINI_API_KEY || 'sk-790c2915854b493abd4e8e8d38318f04'
].filter(key => key && key !== 'your-api-key-here');

// Round-robin API key selection
let currentKeyIndex = 0;

const getNextApiKey = () => {
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
};

const createGenAI = () => {
  const apiKey = getNextApiKey();
  console.log(`Using API key: ${apiKey.substring(0, 10)}...`);
  return new GoogleGenerativeAI(apiKey);
};

if (API_KEYS.length === 0) {
  throw new Error('No valid Gemini API keys found. Please set VITE_GEMINI_API_KEY or provide valid API keys.');
}

let currentKeyIndex = 0;
const keyUsageCount = new Map<string, number>();

function getNextApiKey(): string {
  // Find the key with least usage
  let bestKey = API_KEYS[0];
  let minUsage = keyUsageCount.get(bestKey) || 0;
  
  for (const key of API_KEYS) {
    const usage = keyUsageCount.get(key) || 0;
    if (usage < minUsage) {
      minUsage = usage;
      bestKey = key;
    }
  }
  
  // Increment usage count
  keyUsageCount.set(bestKey, (keyUsageCount.get(bestKey) || 0) + 1);
  
  return bestKey;
}

export interface ExtractedQuestion {
  question_number?: string;
  question_type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
  question_statement: string;
  options?: string[];
  is_continuation?: boolean;
  page_number: number;
  confidence_score?: number;
  spans_multiple_pages?: boolean;
  continuation_from_page?: number;
  has_image?: boolean;
  image_description?: string;
  uploaded_image?: string; // base64 image data
}

export async function analyzePageForQuestions(
  imageBase64: string,
  pageNumber: number,
  previousContext?: string
): Promise<ExtractedQuestion[]> {
  try {
    const apiKey = getNextApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const genAI = createGenAI();
    const genAI = createGenAI();
    const genAI = createGenAI();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
You are an expert at extracting questions from exam papers. Analyze this page image and extract ALL questions with perfect accuracy.

CRITICAL REQUIREMENTS:
1. Extract questions EXACTLY as they appear - no modifications, no paraphrasing, but if any obvious error fix that.
2. Preserve all mathematical expressions, formulas, and symbols
3. Convert mathematical content to LaTeX format when possible (use $ for inline math, $$ for display math)
4. Identify question types: MCQ (single correct), MSQ (multiple correct), NAT (numerical answer), Subjective (descriptive)
5. Extract all options exactly as written for MCQ/MSQ questions
6. Handle multi-page questions - if a question seems incomplete, mark it as continuation
7. Preserve all diagrams, figures, and images by describing them in detail they are probably in description
8. Maintain original formatting, spacing, and structure
9. Say if a description if for next few questions then write that description before each of these questions if for 3 questions then write that description with all
10. Write question statement and options saperately not together
11. If a question have three parts then consider them as three parts and instead of next question number write like 11(A), 11(B), 11(C) and so on.
${previousContext ? `PREVIOUS PAGE CONTEXT: ${previousContext}` : ''}

For each question found, provide:
- question_number (if visible)
- question_type (MCQ/MSQ/NAT/Subjective)
- question_statement (exact text with LaTeX for math)
- options (for MCQ/MSQ, exact text with LaTeX)
- is_continuation (true if this continues from previous page)

If this page contains only instructions, headers, or non-question content, return empty array.

Return response as JSON array of questions. Example:
[
  {
    "question_number": "1",
    "question_type": "MCQ",
    "question_statement": "What is the value of $\\int_0^1 x^2 dx$?",
    "options": ["$\\frac{1}{3}$", "$\\frac{1}{2}$", "$1$", "$\\frac{2}{3}$"],
    "is_continuation": false,
    "page_number": ${pageNumber}
  }
]
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`No questions found on page ${pageNumber}`);
      return [];
    }

    const questions = JSON.parse(jsonMatch[0]) as ExtractedQuestion[];
    return questions.map(q => ({ ...q, page_number: pageNumber }));

  } catch (error) {
    console.error(`Error analyzing page ${pageNumber}:`, error);
    throw new Error(`Failed to analyze page ${pageNumber}: ${error}`);
  }
}

export async function convertPdfToImages(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // Use PDF.js for better PDF handling
    import('pdfjs-dist').then(async (pdfjsLib) => {
      try {
        // Set worker source
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.js',
          import.meta.url
        ).toString();
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const images: string[] = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 4.0 }); // Ultra high resolution for better OCR
          
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          
          await page.render({
            canvasContext: ctx,
            viewport: viewport
          }).promise;
          
          // Convert to base64
          const imageData = canvas.toDataURL('image/png');
          const base64 = imageData.split(',')[1];
          images.push(base64);
        }
        
        resolve(images);
      } catch (error) {
        reject(error);
      }
    }).catch(reject);
  });
}

export async function enhancedQuestionExtraction(
  images: string[],
  startPageNumber: number = 1
): Promise<ExtractedQuestion[]> {
  const allQuestions: ExtractedQuestion[] = [];
  let sharedDescriptions: Map<number, string> = new Map();
  let multiPageQuestions: Map<string, ExtractedQuestion> = new Map();
  
  // First pass: Analyze all pages to identify shared descriptions and multi-page questions
  for (let i = 0; i < images.length; i++) {
    const pageNum = startPageNumber + i;
    
    try {
      const pageAnalysis = await analyzePageStructure(images[i], pageNum, i > 0 ? images[i-1] : undefined, i < images.length - 1 ? images[i+1] : undefined);
      
      // Store shared descriptions
      if (pageAnalysis.sharedDescription) {
        sharedDescriptions.set(pageNum, pageAnalysis.sharedDescription);
      }
      
      // Add delay between API calls to avoid rate limits
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay with key rotation
      }
      
    } catch (error) {
      console.error(`Error in first pass analysis for page ${pageNum}:`, error);
      // Continue with next page if one fails
    }
  }
  
  // Second pass: Extract questions with full context
  for (let i = 0; i < images.length; i++) {
    const pageNum = startPageNumber + i;
    
    try {
      const questions = await extractQuestionsWithContext(
        images[i], 
        pageNum, 
        sharedDescriptions,
        i > 0 ? images[i-1] : undefined,
        i < images.length - 1 ? images[i+1] : undefined,
        allQuestions
      );
      
      allQuestions.push(...questions);
      
      // 10 second delay for round-robin API key rotation
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
    } catch (error) {
      console.error(`Error extracting questions from page ${pageNum}:`, error);
      // Try with next API key
      continue;
    }
  }
  
  return allQuestions;
}

async function analyzePageStructure(
  imageBase64: string,
  pageNumber: number,
  previousImage?: string,
  nextImage?: string
): Promise<{
  sharedDescription?: string;
  hasMultiPageQuestion?: boolean;
  questionNumbers?: string[];
}> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
        }
      });

      const prompt = `
Analyze this exam page to identify structural elements. Focus on:

1. SHARED DESCRIPTIONS: Look for text like "Description for the following X questions:" or "For questions X-Y:" or "Consider the following for next questions:"
2. MULTI-PAGE QUESTIONS: Identify if any question starts but doesn't complete on this page
3. QUESTION NUMBERS: List all question numbers visible on this page

Return JSON with this structure:
{
  "sharedDescription": "Full text of any shared description found",
  "hasMultiPageQuestion": true/false,
  "questionNumbers": ["17", "18", "19"]
}

If no shared description exists, set sharedDescription to null.
`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/png',
            data: imageBase64
          }
        }
      ]);

      const response = await result.response;
      const text = response.text();
      
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        return {};
      }

      return JSON.parse(jsonContent);

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('All API keys exhausted for page structure analysis');
}

async function extractQuestionsWithContext(
  imageBase64: string,
  pageNumber: number,
  sharedDescriptions: Map<number, string>,
  previousImage?: string,
  nextImage?: string,
  previousQuestions: ExtractedQuestion[] = []
): Promise<ExtractedQuestion[]> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
        }
      });

      // Get shared description for this page
      const currentSharedDescription = sharedDescriptions.get(pageNumber);
      
      // Build context from previous questions
      const recentContext = previousQuestions.slice(-3).map(q => 
        `Q${q.question_number}: ${q.question_statement.substring(0, 200)}...`
      ).join('\n');

      const enhancedPrompt = `
You are an EXPERT question extraction system. Extract ALL questions with ABSOLUTE PRECISION.

CRITICAL EXTRACTION RULES:
1. Extract questions EXACTLY as they appear - preserve every word, symbol, formatting
2. Convert math to LaTeX: $...$ for inline, $$...$$ for display math
3. Handle SHARED DESCRIPTIONS: If there's a description for multiple questions, include it with EACH question
4. Handle MULTI-PAGE QUESTIONS: If a question spans pages, extract the complete question
5. Handle DIAGRAMS/TABLES: Describe them in detail and include in question statement
6. NEVER skip questions with diagrams - describe the diagram thoroughly
7. For incomplete questions, mark as continuation and provide what's visible

SHARED DESCRIPTION HANDLING:
${currentSharedDescription ? `SHARED DESCRIPTION FOR THIS PAGE: "${currentSharedDescription}"` : 'No shared description found'}
- If questions share a description, include the FULL description with EACH question
- Example: If "Description for questions 17-18: [text]" exists, include this description in both Q17 and Q18

DIAGRAM/TABLE HANDLING:
- Describe ALL visual elements: charts, graphs, tables, Venn diagrams, figures
- Include table data in structured format
- For Venn diagrams: describe circles, intersections, labels, shaded regions
- For charts: describe data, axes, percentages, values
- NEVER skip questions because they have diagrams

MULTI-PAGE QUESTION HANDLING:
- If question starts but doesn't end on this page, extract what's visible
- Mark as spans_multiple_pages: true
- If question continues from previous page, mark as is_continuation: true

CONTEXT FROM PREVIOUS QUESTIONS:
${recentContext}

RESPONSE FORMAT - ENSURE PROPER JSON ESCAPING:
[
  {
    "question_number": "17",
    "question_type": "MCQ",
    "question_statement": "FULL shared description + question statement + diagram description",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "shared_description": "Full shared description text",
    "has_diagram": true,
    "diagram_description": "Detailed description of diagram/table",
    "table_content": "Structured table data if present",
    "spans_multiple_pages": false,
    "is_continuation": false,
    "page_number": ${pageNumber}
  }
]

CRITICAL: Use double backslashes (\\\\) for ALL LaTeX commands in JSON.
CRITICAL: Include shared descriptions with EVERY question that uses them.
CRITICAL: NEVER skip questions with diagrams - describe them thoroughly.
`;

      const result = await model.generateContent([
        enhancedPrompt,
        {
          inlineData: {
            mimeType: 'image/png',
            data: imageBase64
          }
        }
      ]);

      const response = await result.response;
      const text = response.text();
      
      // Robust JSON extraction
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        console.log(`No valid JSON found on page ${pageNumber}`);
        return [];
      }

      try {
        const questions = JSON.parse(jsonContent) as ExtractedQuestion[];
        return questions.map(q => ({ 
          ...q, 
          page_number: pageNumber,
          confidence_score: q.confidence_score || 1.0
        }));
      } catch (parseError) {
        console.error(`JSON parsing error on page ${pageNumber}:`, parseError);
        return [];
      }

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('All API keys exhausted for question extraction');
}

export async function performExtraction(
  imageBase64: string,
  pageNumber: number,
  previousContext: string = '',
  pageMemory: Map<number, string> = new Map()
): Promise<ExtractedQuestion[]> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
    const apiKey = getNextApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 0.8,
      }
    });

    // Build memory context from previous pages
    const memoryContext = Array.from(pageMemory.entries())
      .slice(-3) // Keep last 3 pages in memory
      .map(([page, content]) => `Page ${page}: ${content.substring(0, 500)}...`)
      .join('\n\n');

    const enhancedPrompt = `
You are an EXPERT question extraction system for competitive exam papers. Extract ONLY actual questions with ABSOLUTE PRECISION.

MULTI-PAGE QUESTION HANDLING:
- CRITICAL: Some questions span multiple pages with long descriptions or multiple parts
- If you see an incomplete question (starts but doesn't end), mark it as spans_multiple_pages: true
- If you see a continuation of a question from previous page, mark it as is_continuation: true
- COMBINE multi-page questions into ONE complete question with full content
- For questions with parts (a, b, c), treat each part as a separate question with shared description

MEMORY CONTEXT FROM PREVIOUS PAGES:
${memoryContext}

PREVIOUS PAGE CONTEXT: ${previousContext}

CRITICAL RULES:
1. IGNORE general instructions, exam rules, or non-question content
2. Extract ONLY numbered questions (1, 2, 3, etc.) or lettered questions (a, b, c, etc.)
3. Include shared descriptions DIRECTLY in question_statement for each applicable question
4. Include diagram/table descriptions DIRECTLY in question_statement (don't separate them)
5. Convert math to LaTeX: use $ for inline math, $$ for display math
6. Question types: MCQ (single answer), MSQ (multiple answers), NAT (numerical), Subjective (descriptive)
7. For JSON: Use double backslashes (\\\\) for LaTeX commands, escape quotes as \\"
8. HANDLE IMAGES: If question has diagrams/images that cannot be described in text, mark has_image: true and provide detailed description

WHAT TO EXTRACT:
- Questions with numbers like "17.", "18.", "Q17", "Question 17"
- Include complete shared descriptions in each question's statement
- Include complete diagram/table descriptions in question statement
- Include all visual elements as text descriptions
- For multi-part questions (17a, 17b, 17c), create separate questions with shared description

WHAT TO IGNORE:
- General exam instructions
- Page headers/footers
- Non-question text
- Instructions that don't relate to specific questions

JSON FORMAT REQUIREMENTS:
- Use \\\\ for all LaTeX backslashes
- Escape quotes as \\"
- No line breaks in strings (use \\n if needed)
- Keep JSON simple and clean

RESPONSE FORMAT (CLEAN JSON ONLY):
[
  {
    "question_number": "17",
    "question_type": "MCQ",
    "question_statement": "Complete shared description + question statement + diagram/table descriptions all combined",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "is_continuation": false,
    "spans_multiple_pages": false,
    "has_image": false,
    "image_description": "Detailed description of any visual elements",
    "page_number": ${pageNumber}
  }
]

CRITICAL: Return ONLY valid JSON. No extra text, no explanations, just the JSON array.
`;

    const result = await model.generateContent([
      enhancedPrompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Store this page's content in memory for future pages
    pageMemory.set(pageNumber, text.substring(0, 1000));
    
    // Robust JSON extraction
    const jsonContent = extractJsonFromText(text);
    if (!jsonContent) {
      console.log(`No questions found on page ${pageNumber}`);
      return [];
    }

    try {
      const questions = JSON.parse(jsonContent) as ExtractedQuestion[];
      return questions.map(q => ({ 
        ...q, 
        page_number: pageNumber,
        confidence_score: q.confidence_score || 1.0
      }));
    } catch (parseError) {
      console.error(`JSON parsing error on page ${pageNumber}:`, parseError);
      return [];
    }

    } catch (error: any) {
      console.error(`Error with API key ${retryCount} for page ${pageNumber}:`, error);
      
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit for page ${pageNumber}, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      if (retryCount >= maxRetries) {
        throw new Error(`All ${maxRetries} API keys exhausted for page ${pageNumber}: ${error.message}`);
      }
    }
  }
  
  throw new Error(`Failed to process page ${pageNumber} after trying all API keys`);
}

// Question Generation Functions
export async function generateQuestionsForTopic(
  topic: any,
  examName: string,
  courseName: string,
  questionType: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective',
  pyqs: any[],
  existingQuestionsContext: string,
  recentlyGenerated: string[],
  count: number = 1
): Promise<ExtractedQuestion[]> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.9,
        }
      });

      // Build context from PYQs
      const pyqContext = pyqs.slice(0, 10).map((pyq, index) => 
        `PYQ ${index + 1}: ${pyq.question_statement}${pyq.options ? `\nOptions: ${pyq.options.join(', ')}` : ''}`
      ).join('\n\n');

      // Build context from recently generated
      const recentContext = recentlyGenerated.slice(-3).map((q, index) => 
        `Recent ${index + 1}: ${q.substring(0, 200)}...`
      ).join('\n\n');

      const questionTypeInstructions = {
        MCQ: 'Generate Multiple Choice Questions with exactly 4 options (A, B, C, D). Only ONE option should be correct. Ensure equal distribution of correct answers across options A, B, C, D over multiple questions.',
        MSQ: 'Generate Multiple Select Questions with 4-5 options. MORE THAN ONE option can be correct. Include partial marking scenarios.',
        NAT: 'Generate Numerical Answer Type questions where the answer is a number (integer or decimal). No options needed.',
        Subjective: 'Generate descriptive questions that require detailed explanations, proofs, or derivations. No options needed.'
      };

      const prompt = `
You are an expert question generator for ${examName} - ${courseName} entrance examination.

TOPIC: ${topic.name}
WEIGHTAGE: ${((topic.weightage || 0.02) * 100).toFixed(1)}% of total syllabus
QUESTION TYPE: ${questionType}

TOPIC NOTES (Use these concepts in solutions):
${topic.notes || 'No specific notes available'}

PREVIOUS YEAR QUESTIONS FROM THIS TOPIC:
${pyqContext || 'No PYQs available for this topic'}

EXISTING QUESTIONS ALREADY GENERATED FOR THIS TOPIC (${existingQuestionsContext ? existingQuestionsContext.split('\n\n').length : 0} questions):
${existingQuestionsContext || 'No existing questions generated yet for this topic'}

RECENTLY GENERATED QUESTIONS (Don't repeat):
${recentContext || 'No recent questions'}

INSTRUCTIONS:
1. ${questionTypeInstructions[questionType]}
2. Analyze the PYQ patterns and generate questions of SIMILAR or HIGHER difficulty
3. Use the same conceptual approach as the professor who set the PYQs
4. CRITICAL: DO NOT repeat any of the existing questions shown above - generate completely NEW and UNIQUE questions
5. Use different problem scenarios, numerical values, and contexts from existing questions
6. Ensure questions test deep understanding, not just memorization
7. For MCQ: Distribute correct answers equally across options A, B, C, D. ENSURE the correct answer is ALWAYS one of the 4 options.
8. For MSQ: Can have 1, 2, 3, or 4 correct options. ENSURE all correct answers are present in the options.
9. Include relevant formulas, concepts, and problem-solving approaches
10. Make questions challenging but fair for entrance exam level
11. Use LaTeX for mathematical expressions: $ for inline, $$ for display
12. Generate FRESH questions with different approaches, examples, and numerical values
13. Ensure the question difficulty matches the topic's weightage importance
14. CRITICAL: The answer must EXACTLY match one of the provided options (for MCQ) or be a combination of the provided options (for MSQ)

UNIQUENESS REQUIREMENTS:
- Use different numerical values from existing questions
- Apply concepts to different real-world scenarios
- Use different problem-solving approaches
- Create questions that test the same concepts but with fresh perspectives
- Avoid similar wording or structure to existing questions

ANSWER MATCHING REQUIREMENTS:
- For MCQ: The correct answer must be EXACTLY option A, B, C, or D
- For MSQ: The correct answers must be a combination like "A", "B,C", "A,C,D", etc.
- Keep mathematical expressions in standard form (π/3, not 1.047...)
- Ensure numerical answers match the format used in options
- If generating fractions, keep them in simplest form
- For expressions with constants, use standard mathematical notation

QUALITY REQUIREMENTS:
- Questions should be at entrance exam difficulty level
- Test conceptual understanding and application
- Include numerical problems, theoretical concepts, and application-based scenarios
- Ensure proper grammar and clear question statements
- Make distractors (wrong options) plausible but clearly incorrect
- Each question must be COMPLETELY DIFFERENT from all existing questions
- CRITICAL: Verify that the answer corresponds to one of the options before finalizing

Generate ${count} high-quality ${questionType} question(s) for this topic.

RESPONSE FORMAT (JSON only):
[
  {
    "question_statement": "Complete question with LaTeX math formatting",
    "question_type": "${questionType}",
    "options": ${questionType === 'MCQ' || questionType === 'MSQ' ? '["Option A", "Option B", "Option C", "Option D"]' : 'null'},
    "answer": "Correct answer(s) - for MCQ: single option like 'A', for MSQ: one or more like 'A', 'B,C', 'A,C,D', for NAT: numerical value, for Subjective: key points",
    "solution": "Detailed step-by-step solution using concepts from topic notes",
    "topic_id": "${topic.id}",
    "difficulty_level": "Medium"
  }
]

CRITICAL: 
- Return ONLY valid JSON. Use double backslashes (\\\\) for LaTeX commands.
- Generate UNIQUE questions that are COMPLETELY DIFFERENT from existing ones.
- Use the PYQs as reference for difficulty and style, but create original content.
- VERIFY that the answer matches the options before returning the response.
- For MSQ, ensure 1-4 options can be correct, not necessarily multiple.
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      // Robust JSON extraction
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        console.log(`No valid JSON found for topic ${topic.name}`);
        return [];
      }

      try {
        const questions = JSON.parse(jsonContent) as ExtractedQuestion[];
        return questions.map(q => ({ 
          ...q,
          confidence_score: 1.0
        }));
      } catch (parseError) {
        console.error(`JSON parsing error for topic ${topic.name}:`, parseError);
        return [];
      }

    } catch (error: any) {
      retryCount++;
      console.error(`Error with API key ${retryCount} for topic ${topic.name}:`, error);
      
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit for topic ${topic.name}, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      if (retryCount >= maxRetries) {
        throw new Error(`All ${maxRetries} API keys exhausted for topic ${topic.name}: ${error.message}`);
      }
    }
  }
  
  throw new Error(`Failed to generate questions for topic ${topic.name} after trying all API keys`);
}

// Answer validation functions
export function validateQuestionAnswer(question: ExtractedQuestion): { isValid: boolean; reason?: string } {
  const { question_type, options, answer } = question;
  
  if (!answer || answer.trim() === '') {
    return { isValid: false, reason: 'No answer provided' };
  }
  
  switch (question_type) {
    case 'MCQ':
      return validateMCQAnswer(options, answer);
    case 'MSQ':
      return validateMSQAnswer(options, answer);
    case 'NAT':
      return validateNATAnswer(answer);
    case 'Subjective':
      return validateSubjectiveAnswer(answer);
    default:
      return { isValid: false, reason: 'Unknown question type' };
  }
}

// Enhanced validation with correction capabilities
export async function validateAndFixQuestion(question: ExtractedQuestion): Promise<{ 
  isValid: boolean; 
  correctedQuestion?: ExtractedQuestion; 
  reason?: string 
}> {
  // First, solve the question using AI to get the correct answer
  try {
    const solvedQuestion = await solveQuestionWithAI(question);
    
    // Check if the solved answer matches the current answer and options
    const validation = await validateQuestionComprehensively(question, solvedQuestion);
    
    if (validation.isValid) {
      return { isValid: true, correctedQuestion: question };
    }
    
    // If validation failed, fix the question comprehensively
    const fixedQuestion = await fixQuestionComprehensively(question, solvedQuestion, validation.issues);
    
    // Validate the fixed question
    const fixedValidation = await validateQuestionComprehensively(fixedQuestion, solvedQuestion);
    
    if (fixedValidation.isValid) {
      return { 
        isValid: true, 
        correctedQuestion: fixedQuestion,
        reason: `Fixed issues: ${validation.issues.join(', ')}`
      };
    } else {
      return { 
        isValid: false, 
        reason: `Could not fix issues: ${validation.issues.join(', ')}`
      };
    }
    
  } catch (error) {
    return { 
      isValid: false, 
      reason: `Validation error: ${error.message}`
    };
  }
}

// Solve question using AI to get the correct answer
async function solveQuestionWithAI(question: ExtractedQuestion): Promise<{
  correctAnswer: string;
  solution: string;
  reasoning: string;
}> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
        }
      });

      const prompt = `
You are an expert problem solver for competitive exams. Solve this ${question.question_type} question step by step.

QUESTION: ${question.question_statement}
${question.options ? `OPTIONS: ${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}: ${opt}`).join('\n')}` : ''}
QUESTION TYPE: ${question.question_type}

INSTRUCTIONS:
1. Read and understand the question completely
2. Solve it step by step using proper mathematical/scientific methods
3. For MCQ: Identify which single option (A, B, C, or D) is correct
4. For MSQ: Identify which options (can be 1, 2, 3, or 4) are correct
5. For NAT: Calculate the exact numerical answer
6. For Subjective: Provide the key result/conclusion
7. Provide detailed reasoning and solution steps
8. Use LaTeX for mathematical expressions

RESPONSE FORMAT (JSON only):
{
  "correctAnswer": "For MCQ: 'A', 'B', 'C', or 'D'. For MSQ: 'A', 'B,C', 'A,C,D', etc. For NAT: numerical value. For Subjective: key result",
  "solution": "Detailed step-by-step solution with LaTeX formatting",
  "reasoning": "Brief explanation of why this is the correct answer"
}

CRITICAL: Return ONLY valid JSON. Use double backslashes (\\\\) for LaTeX commands.
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        throw new Error('No valid JSON response for question solving');
      }

      const solved = JSON.parse(jsonContent);
      return {
        correctAnswer: solved.correctAnswer,
        solution: solved.solution,
        reasoning: solved.reasoning
      };

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('Failed to solve question after trying all API keys');
}

// Comprehensive validation of question against solved answer
async function validateQuestionComprehensively(
  question: ExtractedQuestion, 
  solvedQuestion: { correctAnswer: string; solution: string; reasoning: string }
): Promise<{ isValid: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  // Check if question statement is complete and makes sense
  if (!question.question_statement || question.question_statement.trim().length < 10) {
    issues.push('Question statement is too short or empty');
  }
  
  // Type-specific validation
  switch (question.question_type) {
    case 'MCQ':
      if (!question.options || question.options.length !== 4) {
        issues.push('MCQ must have exactly 4 options');
      } else {
        // Check if the solved answer matches any option
        const correctOption = solvedQuestion.correctAnswer.trim().toUpperCase();
        if (!['A', 'B', 'C', 'D'].includes(correctOption)) {
          issues.push('Solved answer is not a valid MCQ option (A, B, C, D)');
        }
        
        // Check if current answer matches solved answer
        if (question.answer?.trim().toUpperCase() !== correctOption) {
          issues.push(`Current answer "${question.answer}" doesn't match solved answer "${correctOption}"`);
        }
      }
      break;
      
    case 'MSQ':
      if (!question.options || question.options.length < 4) {
        issues.push('MSQ must have at least 4 options');
      } else {
        // Validate solved answer format
        const correctOptions = solvedQuestion.correctAnswer.split(',').map(opt => opt.trim().toUpperCase());
        const validOptions = ['A', 'B', 'C', 'D', 'E'];
        
        for (const opt of correctOptions) {
          if (!validOptions.includes(opt)) {
            issues.push(`Invalid MSQ option "${opt}" in solved answer`);
          }
        }
        
        // Check if current answer matches solved answer
        const currentAnswerOptions = question.answer?.split(',').map(opt => opt.trim().toUpperCase()).sort() || [];
        const solvedAnswerOptions = correctOptions.sort();
        
        if (JSON.stringify(currentAnswerOptions) !== JSON.stringify(solvedAnswerOptions)) {
          issues.push(`Current answer "${question.answer}" doesn't match solved answer "${solvedQuestion.correctAnswer}"`);
        }
      }
      break;
      
    case 'NAT':
      // Check if solved answer is numerical
      const numericAnswer = parseFloat(solvedQuestion.correctAnswer);
      if (isNaN(numericAnswer)) {
        issues.push('NAT question solved answer is not numerical');
      }
      
      // Check if current answer matches solved answer (with tolerance)
      const currentNumeric = parseFloat(question.answer || '');
      if (isNaN(currentNumeric) || Math.abs(currentNumeric - numericAnswer) > 0.001) {
        issues.push(`Current answer "${question.answer}" doesn't match solved answer "${solvedQuestion.correctAnswer}"`);
      }
      break;
      
    case 'Subjective':
      // For subjective, just check if answer exists and is meaningful
      if (!question.answer || question.answer.trim().length < 5) {
        issues.push('Subjective answer is too short or missing');
      }
      break;
  }
  
  // Check solution quality
  if (!question.solution || question.solution.trim().length < 20) {
    issues.push('Solution is too short or missing');
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

// Fix question comprehensively with proper option distribution
async function fixQuestionComprehensively(
  question: ExtractedQuestion,
  solvedQuestion: { correctAnswer: string; solution: string; reasoning: string },
  issues: string[]
): Promise<ExtractedQuestion> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.3,
          topK: 20,
          topP: 0.8,
        }
      });

      // Generate random correct answer position for equal distribution
      let correctAnswerPosition = 0;
      let correctAnswerLetter = 'A';
      
      if (question.question_type === 'MCQ') {
        correctAnswerPosition = Math.floor(Math.random() * 4); // 0-3 for A-D
        correctAnswerLetter = String.fromCharCode(65 + correctAnswerPosition);
      }

      const prompt = `
You are an expert question corrector for competitive exams. Fix this ${question.question_type} question based on the solved answer and identified issues.

ORIGINAL QUESTION: ${question.question_statement}
${question.options ? `ORIGINAL OPTIONS: ${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}: ${opt}`).join('\n')}` : ''}
ORIGINAL ANSWER: ${question.answer}
ORIGINAL SOLUTION: ${question.solution || 'No solution provided'}

SOLVED CORRECT ANSWER: ${solvedQuestion.correctAnswer}
SOLVED SOLUTION: ${solvedQuestion.solution}
SOLVED REASONING: ${solvedQuestion.reasoning}

IDENTIFIED ISSUES: ${issues.join(', ')}

FIXING REQUIREMENTS:
${question.question_type === 'MCQ' ? `
1. CRITICAL: The correct answer MUST be option ${correctAnswerLetter} (position ${correctAnswerPosition + 1})
2. Create 4 high-quality options where option ${correctAnswerLetter} contains the solved answer
3. Make all options plausible and competitive exam quality
4. Ensure 25% probability distribution across A, B, C, D over multiple questions
` : ''}
${question.question_type === 'MSQ' ? `
1. Create 4-5 high-quality options
2. Ensure the solved answer options are correct
3. Make other options plausible but incorrect
4. Vary the number of correct options (1, 2, 3, or 4) for equal distribution
` : ''}
${question.question_type === 'NAT' ? `
1. Ensure the question leads to the solved numerical answer
2. Adjust question statement if needed to match the solved answer
3. No options needed for NAT questions
` : ''}
${question.question_type === 'Subjective' ? `
1. Ensure the question is clear and complete
2. Provide comprehensive answer based on solved solution
3. No options needed for Subjective questions
` : ''}

QUALITY STANDARDS:
- Keep question statement as close to original as possible unless it has errors
- All options should be at similar difficulty level
- Avoid obviously wrong options - make them plausible
- Use proper mathematical notation and LaTeX formatting
- Ensure solution explains the reasoning clearly
- Make distractors based on common mistakes or alternative approaches

RESPONSE FORMAT (JSON only):
{
  "question_statement": "Fixed question statement (only if needed)",
  "options": ${question.question_type === 'MCQ' || question.question_type === 'MSQ' ? '["Fixed Option A", "Fixed Option B", "Fixed Option C", "Fixed Option D"]' : 'null'},
  "answer": "${question.question_type === 'MCQ' ? correctAnswerLetter : 'Fixed answer based on solved answer'}",
  "solution": "Comprehensive solution based on solved reasoning"
}

CRITICAL: 
- Return ONLY valid JSON
- Use double backslashes (\\\\) for LaTeX commands
${question.question_type === 'MCQ' ? `- The answer MUST be "${correctAnswerLetter}" and option ${correctAnswerLetter} must contain the solved answer` : ''}
- Ensure all options are competitive exam quality with no easy eliminations
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        throw new Error('No valid JSON response for question fixing');
      }

      const fixedData = JSON.parse(jsonContent);
      
      return {
        ...question,
        question_statement: fixedData.question_statement || question.question_statement,
        options: fixedData.options || question.options,
        answer: fixedData.answer,
        solution: fixedData.solution
      };

    } catch (error) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('Failed to fix question comprehensively after trying all API keys');
}

// Comprehensive question solving function
export const solveQuestionWithAI = async (question: any): Promise<{
  correctAnswer: string;
  detailedSolution: string;
  reasoning: string;
}> => {
  try {
    const genAI = createGenAI();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are an expert in competitive exams. Solve this question completely and provide the correct answer with detailed reasoning.

QUESTION TO SOLVE:
Statement: ${question.question_statement}
Type: ${question.question_type}
${question.options ? `Options: ${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}: ${opt}`).join(', ')}` : ''}
${question.answer ? `Given Answer: ${question.answer}` : ''}

TASK:
1. Solve this question step by step
2. Determine the correct answer
3. Provide detailed reasoning
4. For MCQ/MSQ: Identify which option(s) are correct
5. For NAT: Calculate the numerical answer
6. For Subjective: Provide comprehensive answer

CRITICAL: Return ONLY valid JSON. No markdown, no explanations.

Expected JSON format:
{
  "correctAnswer": "A" or "A,C" or "123" or "Descriptive answer",
  "detailedSolution": "Complete step-by-step solution with formulas and calculations",
  "reasoning": "Brief explanation of why this is the correct answer"
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
    
    try {
      const solution = JSON.parse(cleanedText);
      
      if (!solution.correctAnswer || !solution.detailedSolution) {
        throw new Error('Invalid solution format');
      }
      
      return solution;
      
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      console.log('Raw response:', text);
      throw new Error('Failed to parse AI solution');
    }
    
  } catch (error) {
    console.error('Error solving question:', error);
    throw new Error(`Failed to solve question: ${error.message}`);
  }
};

// Comprehensive question validation
export const validateQuestionComprehensively = async (question: any): Promise<{
  isValid: boolean;
  issues: string[];
  solvedAnswer: string;
  solvedSolution: string;
}> => {
  try {
    // First, solve the question to get the correct answer
    const solution = await solveQuestionWithAI(question);
    const issues: string[] = [];
    
    // Check question statement
    if (!question.question_statement || question.question_statement.trim().length < 10) {
      issues.push('Question statement is too short or missing');
    }
    
    // Type-specific validation
    if (question.question_type === 'MCQ') {
      // Check if options exist and are valid
      if (!question.options || question.options.length !== 4) {
        issues.push('MCQ must have exactly 4 options');
      }
      
      // Check if answer matches solved answer
      if (question.answer !== solution.correctAnswer) {
        issues.push(`Answer mismatch: given "${question.answer}", solved "${solution.correctAnswer}"`);
      }
      
      // Check if answer is valid option
      if (question.answer && !['A', 'B', 'C', 'D'].includes(question.answer)) {
        issues.push('MCQ answer must be A, B, C, or D');
      }
      
    } else if (question.question_type === 'MSQ') {
      // Check if options exist
      if (!question.options || question.options.length !== 4) {
        issues.push('MSQ must have exactly 4 options');
      }
      
      // Check if answer format is correct
      if (question.answer && !/^[A-D](,[A-D])*$/.test(question.answer)) {
        issues.push('MSQ answer must be in format A,B,C or similar');
      }
      
      // Check if answer matches solved answer
      const normalizeAnswer = (ans: string) => ans.split(',').sort().join(',');
      if (question.answer && normalizeAnswer(question.answer) !== normalizeAnswer(solution.correctAnswer)) {
        issues.push(`Answer mismatch: given "${question.answer}", solved "${solution.correctAnswer}"`);
      }
      
    } else if (question.question_type === 'NAT') {
      // Check if answer is numerical
      const numAnswer = parseInt(question.answer);
      const solvedNumAnswer = parseInt(solution.correctAnswer);
      
      if (isNaN(numAnswer) || numAnswer < 0 || numAnswer > 999) {
        issues.push('NAT answer must be integer between 0-999');
      }
      
      if (numAnswer !== solvedNumAnswer) {
        issues.push(`Numerical answer mismatch: given "${question.answer}", solved "${solution.correctAnswer}"`);
      }
      
    } else if (question.question_type === 'Subjective') {
      // Check if answer exists and is substantial
      if (!question.answer || question.answer.trim().length < 20) {
        issues.push('Subjective answer is too short or missing');
      }
    }
    
    // Check solution quality
    if (!question.solution || question.solution.trim().length < 30) {
      issues.push('Solution is too short or missing');
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      solvedAnswer: solution.correctAnswer,
      solvedSolution: solution.detailedSolution
    };
    
  } catch (error) {
    console.error('Error validating question:', error);
    return {
      isValid: false,
      issues: [`Validation error: ${error.message}`],
      solvedAnswer: '',
      solvedSolution: ''
    };
  }
};

// Comprehensive question fixing
export const fixQuestionComprehensively = async (
  question: any,
  solvedAnswer: string,
  solvedSolution: string
): Promise<ExtractedQuestion> => {
  try {
    const genAI = createGenAI();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are an expert question fixer for competitive exams. Fix this question to ensure 100% accuracy with proper option distribution.

ORIGINAL QUESTION:
Statement: ${question.question_statement}
Type: ${question.question_type}
Current Options: ${question.options ? question.options.join(', ') : 'None'}
Current Answer: ${question.answer || 'None'}
Current Solution: ${question.solution || 'None'}

CORRECT SOLUTION FROM AI:
Correct Answer: ${solvedAnswer}
Detailed Solution: ${solvedSolution}

FIXING REQUIREMENTS:
${question.question_type === 'MCQ' ? `
1. Create 4 competitive options where only ONE is correct
2. Place correct answer randomly in position A, B, C, or D (25% distribution)
3. Make all wrong options plausible but clearly incorrect
4. Avoid obviously wrong answers
5. Ensure options are of similar length and complexity
` : question.question_type === 'MSQ' ? `
1. Create 4 options with variable number of correct answers
2. Randomly choose 1, 2, 3, or 4 correct options (25% each for balanced distribution)
3. Make all options relevant and challenging
4. Ensure correct options are truly correct and wrong ones are clearly wrong
` : question.question_type === 'NAT' ? `
1. Ensure question leads to the numerical answer: ${solvedAnswer}
2. Modify question statement if needed to match the solved answer
3. Question should have clean integer solution (0-999)
4. No options needed for NAT type
` : `
1. Ensure question requires comprehensive descriptive answer
2. Question should test conceptual understanding
3. No options needed for Subjective type
`}

QUALITY STANDARDS:
1. Question statement should be clear and unambiguous
2. Use proper LaTeX notation: $inline$ or $$display$$
3. All options should be grammatically correct
4. Solution should be detailed with step-by-step reasoning
5. Answer should match the solved answer exactly

CRITICAL: Return ONLY valid JSON. No markdown, no explanations.

Expected JSON format:
{
  "question_statement": "Fixed question statement with LaTeX if needed",
  "question_type": "${question.question_type}",
  "options": ${question.question_type === 'MCQ' || question.question_type === 'MSQ' ? '["Option A", "Option B", "Option C", "Option D"]' : 'null'},
  "answer": "${solvedAnswer}",
  "solution": "Complete detailed solution with proper reasoning"
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
    
    try {
      const fixedQuestion = JSON.parse(cleanedText);
      
      // Ensure all required fields are present
      return {
        question_statement: fixedQuestion.question_statement || question.question_statement,
        question_type: question.question_type,
        options: fixedQuestion.options,
        answer: solvedAnswer, // Always use the solved answer
        solution: fixedQuestion.solution || solvedSolution,
        topic_id: question.topic_id,
        page_number: 1,
        has_image: false,
        image_description: null,
        is_continuation: false,
        spans_multiple_pages: false
      };
      
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      console.log('Raw response:', text);
      
      // Fallback: return question with corrected answer and solution
      return {
        question_statement: question.question_statement,
        question_type: question.question_type,
        options: question.options,
        answer: solvedAnswer,
        solution: solvedSolution,
        topic_id: question.topic_id,
        page_number: 1,
        has_image: false,
        image_description: null,
        is_continuation: false,
        spans_multiple_pages: false
      };
    }
    
  } catch (error) {
    console.error('Error fixing question:', error);
    throw new Error(`Failed to fix question: ${error.message}`);
  }
};

// Main validation and fixing function
export const validateAndFixQuestion = async (question: any): Promise<{
  isValid: boolean;
  reason?: string;
  correctedQuestion?: ExtractedQuestion;
}> => {
  try {
    // Step 1: Comprehensive validation
    const validation = await validateQuestionComprehensively(question);
    
    if (validation.isValid) {
      return {
        isValid: true,
        reason: 'Question is already valid'
      };
    }
    
    // Step 2: Fix the question comprehensively
    const correctedQuestion = await fixQuestionComprehensively(
      question,
      validation.solvedAnswer,
      validation.solvedSolution
    );
    
    return {
      isValid: true,
      reason: `Fixed issues: ${validation.issues.join(', ')}`,
      correctedQuestion
    };
    
  } catch (error) {
    console.error('Error in validateAndFixQuestion:', error);
    return {
      isValid: false,
      reason: `Validation/fixing failed: ${error.message}`
    };
  }
};

// Legacy function for backward compatibility
export async function validateAndCorrectQuestion(question: ExtractedQuestion): Promise<{ 
  isValid: boolean; 
  correctedQuestion?: ExtractedQuestion; 
  reason?: string 
}> {
  // Use the new comprehensive validation function
  return await validateAndFixQuestion(question);
}

// Validate question content using AI
async function validateQuestionContent(question: ExtractedQuestion): Promise<{ 
  isValid: boolean; 
  reason?: string 
}> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
        }
      });

      const prompt = `
You are an expert question validator. Analyze this ${question.question_type} question for correctness and consistency.

QUESTION: ${question.question_statement}
${question.options ? `OPTIONS: ${question.options.join(', ')}` : ''}
ANSWER: ${question.answer}
SOLUTION: ${question.solution || 'No solution provided'}

VALIDATION CHECKS:
1. Does the question statement make sense and is it complete?
2. For MCQ/MSQ: Do the options relate to the question? Are they plausible?
3. Does the provided answer actually match one of the options (for MCQ/MSQ)?
4. Is the answer mathematically/logically correct for the question?
5. Does the solution (if provided) lead to the correct answer?
6. Are there any obvious errors or inconsistencies?

RESPONSE FORMAT (JSON only):
{
  "isValid": true/false,
  "issues": ["List of specific issues found"],
  "correctAnswer": "What the correct answer should be (if different)",
  "explanation": "Brief explanation of the validation result"
}

CRITICAL: Return ONLY valid JSON. Be thorough but concise.
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        return { isValid: false, reason: 'Could not validate question content' };
      }

      const validation = JSON.parse(jsonContent);
      
      return {
        isValid: validation.isValid,
        reason: validation.issues?.join(', ') || validation.explanation
      };

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('Failed to validate question content after trying all API keys');
}

// Fix question issues using AI
async function fixQuestionIssuesWithEqualProbability(question: ExtractedQuestion, issues: string[]): Promise<ExtractedQuestion> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.3,
          topK: 20,
          topP: 0.8,
        }
      });

      // Generate a random correct answer position for equal probability
      const correctAnswerPosition = Math.floor(Math.random() * 4); // 0-3 for A-D
      const correctAnswerLetter = String.fromCharCode(65 + correctAnswerPosition); // A, B, C, or D

      const prompt = `
You are an expert question corrector for competitive exams like JEE, NEET, GATE. Fix the following ${question.question_type} question based on the identified issues.

ORIGINAL QUESTION: ${question.question_statement}
${question.options ? `ORIGINAL OPTIONS: ${question.options.join(', ')}` : ''}
ORIGINAL ANSWER: ${question.answer}
ORIGINAL SOLUTION: ${question.solution || 'No solution provided'}

IDENTIFIED ISSUES: ${issues.join(', ')}

CRITICAL REQUIREMENTS FOR EQUAL PROBABILITY:
${question.question_type === 'MCQ' ? `- The correct answer MUST be option ${correctAnswerLetter} (position ${correctAnswerPosition + 1})` : ''}
${question.question_type === 'MSQ' ? `- Ensure 1-3 options can be correct, with varied combinations across questions` : ''}
- This ensures 25% probability for each option in MCQ across all questions
- Avoid patterns that make answers predictable

FIXING INSTRUCTIONS:
1. Keep the question statement as close to original as possible unless it has errors
2. Create 4 high-quality, plausible options that test deep understanding
3. Make ALL options look reasonable - avoid obviously wrong answers
4. For MCQ: Make the correct answer option ${correctAnswerLetter} by adjusting the options accordingly
5. For MSQ: Create a balanced set where 1-3 options can be correct
6. Ensure distractors (wrong options) are based on common mistakes or misconceptions
7. All options should be at similar difficulty level - no "gimme" answers
8. Update solution to clearly explain why the correct option(s) are right and others are wrong
9. Use proper mathematical notation and LaTeX formatting
10. Maintain competitive exam standards (JEE/NEET/GATE level difficulty)

OPTION QUALITY STANDARDS:
- Each option should represent a different approach or common mistake
- Numerical values should be close enough to require actual calculation
- Avoid options like "None of these" or obviously incorrect values
- For physics/chemistry: Use realistic values and units
- For mathematics: Ensure all options are mathematically plausible

RESPONSE FORMAT (JSON only):
{
  "question_statement": "Corrected question statement",
  "question_type": "${question.question_type}",
  "options": ${question.options ? '["Corrected Option A", "Corrected Option B", "Corrected Option C", "Corrected Option D"]' : 'null'},
  "answer": "${question.question_type === 'MCQ' ? correctAnswerLetter : 'Corrected answer'}",
  "solution": "Corrected detailed solution"
}

CRITICAL: 
- Return ONLY valid JSON
- Use double backslashes (\\\\) for LaTeX commands
- For MCQ: The answer MUST be "${correctAnswerLetter}" and option ${correctAnswerLetter} must be the correct one
- For MSQ: Ensure the answer format matches the correct option combination
- Keep the same question type and educational intent
- Make all 4 options competitive exam quality - no easy eliminations
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        throw new Error('No valid JSON response for question fixing');
      }

      const fixedQuestion = JSON.parse(jsonContent);
      
      return {
        ...question,
        question_statement: fixedQuestion.question_statement,
        options: fixedQuestion.options,
        answer: fixedQuestion.answer,
        solution: fixedQuestion.solution
      };

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('Failed to fix question issues with equal probability after trying all API keys');
}

// Correct question options using AI
async function correctQuestionOptions(question: ExtractedQuestion): Promise<ExtractedQuestion> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.3,
          topK: 20,
          topP: 0.8,
        }
      });

      const prompt = `
You are an expert question corrector. The following ${question.question_type} question has an answer that doesn't match any of the provided options.

QUESTION: ${question.question_statement}
CURRENT OPTIONS: ${question.options?.join(', ')}
CORRECT ANSWER: ${question.answer}
QUESTION TYPE: ${question.question_type}

TASK: Fix the options to include the correct answer while maintaining educational value.

RULES:
1. For MCQ: Ensure exactly ONE of the 4 options matches the correct answer
2. For MSQ: Ensure the correct answer options are present (can be 1, 2, 3, or 4 options)
3. Keep mathematical expressions in their simplest, most standard form (e.g., π/3, not 1.047...)
4. Replace the LEAST relevant/most obviously wrong option with the correct answer
5. Maintain consistent formatting and difficulty level
6. Ensure all options are plausible but only the correct one(s) are actually correct
7. For MSQ, if answer is "A,C", ensure options A and C are correct, B and D are incorrect

CORRECTION STRATEGY:
- Identify which option is least relevant or most obviously incorrect
- Replace it with the correct answer in proper format
- Ensure the correct answer fits naturally with other options
- Maintain mathematical/scientific notation consistency

RESPONSE FORMAT (JSON only):
{
  "corrected_options": ["Option A", "Option B", "Option C", "Option D"],
  "explanation": "Brief explanation of what was corrected"
}

CRITICAL: Return ONLY valid JSON. Use double backslashes (\\\\) for LaTeX commands.
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        throw new Error('No valid JSON response for correction');
      }

      const correction = JSON.parse(jsonContent);
      
      return {
        ...question,
        options: correction.corrected_options
      };

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('Failed to correct question options after trying all API keys');
}

function validateMCQAnswer(options: string[] | null, answer: string): { isValid: boolean; reason?: string } {
  if (!options || options.length === 0) {
    return { isValid: false, reason: 'No options provided for MCQ' };
  }
  
  const cleanAnswer = answer.trim().toUpperCase();
  const validOptions = ['A', 'B', 'C', 'D', 'E'];
  
  // Check if answer is a valid option letter
  if (!validOptions.includes(cleanAnswer)) {
    return { isValid: false, reason: `Answer "${answer}" is not a valid option (A, B, C, D, E)` };
  }
  
  // Check if the option index exists
  const optionIndex = cleanAnswer.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
  if (optionIndex >= options.length) {
    return { isValid: false, reason: `Answer "${answer}" refers to option ${optionIndex + 1} but only ${options.length} options provided` };
  }
  
  return { isValid: true };
}

function validateMSQAnswer(options: string[] | null, answer: string): { isValid: boolean; reason?: string } {
  if (!options || options.length === 0) {
    return { isValid: false, reason: 'No options provided for MSQ' };
  }
  
  const cleanAnswer = answer.trim().toUpperCase();
  const answerOptions = cleanAnswer.split(',').map(opt => opt.trim());
  const validOptions = ['A', 'B', 'C', 'D', 'E'];
  
  // Check if all answer options are valid letters
  for (const opt of answerOptions) {
    if (!validOptions.includes(opt)) {
      return { isValid: false, reason: `Answer option "${opt}" is not valid (A, B, C, D, E)` };
    }
    
    // Check if the option index exists
    const optionIndex = opt.charCodeAt(0) - 65;
    if (optionIndex >= options.length) {
      return { isValid: false, reason: `Answer option "${opt}" refers to option ${optionIndex + 1} but only ${options.length} options provided` };
    }
  }
  
  // MSQ can have 1 or more correct options (1, 2, 3, or 4)
  if (answerOptions.length < 1 || answerOptions.length > 4) {
    return { isValid: false, reason: 'MSQ should have 1-4 correct options' };
  }
  
  return { isValid: true };
}

function validateNATAnswer(answer: string): { isValid: boolean; reason?: string } {
  const cleanAnswer = answer.trim();
  
  // Check if answer is a number (integer or decimal)
  const numberRegex = /^-?\d+(\.\d+)?$/;
  if (!numberRegex.test(cleanAnswer)) {
    return { isValid: false, reason: `NAT answer "${answer}" is not a valid number` };
  }
  
  return { isValid: true };
}

function validateSubjectiveAnswer(answer: string): { isValid: boolean; reason?: string } {
  const cleanAnswer = answer.trim();
  
  // Subjective answers should have meaningful content (at least 10 characters)
  if (cleanAnswer.length < 10) {
    return { isValid: false, reason: 'Subjective answer is too short (minimum 10 characters)' };
  }
  
  return { isValid: true };
}
export async function generateSolutionsForPYQs(
  pyqs: any[],
  topicNotes: string
): Promise<ExtractedQuestion[]> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.3,
          topK: 20,
          topP: 0.8,
        }
      });

      const pyqsToSolve = pyqs.slice(0, 5); // Process up to 5 PYQs at once
      
      const pyqContext = pyqsToSolve.map((pyq, index) => 
        `PYQ ${index + 1}:
Question: ${pyq.question_statement}
${pyq.options ? `Options: ${pyq.options.join(', ')}` : ''}
Type: ${pyq.question_type}
Year: ${pyq.year || 'Unknown'}
`
      ).join('\n\n');

      const prompt = `
You are an expert solution generator for competitive exam questions.

TOPIC NOTES (Base your solutions on these concepts):
${topicNotes || 'Use standard concepts for this topic'}

PREVIOUS YEAR QUESTIONS TO SOLVE:
${pyqContext}

INSTRUCTIONS:
1. Generate accurate answers and detailed solutions for each PYQ
2. Base solutions on the provided topic notes and standard concepts
3. For MCQ/MSQ: Identify the correct option(s) and explain why others are wrong
4. For NAT: Provide the exact numerical answer with proper units
5. For Subjective: Provide comprehensive step-by-step solutions
6. Use LaTeX for mathematical expressions: $ for inline, $$ for display
7. Explain the reasoning and methodology clearly
8. Include relevant formulas and concepts from the topic notes
9. Make solutions educational and easy to understand

RESPONSE FORMAT (JSON only):
[
  {
    "answer": "Correct answer - for MCQ: 'A', for MSQ: 'A,C', for NAT: numerical value, for Subjective: key result",
    "solution": "Detailed step-by-step solution with LaTeX formatting"
  }
]

CRITICAL: Return ONLY valid JSON. Use double backslashes (\\\\) for LaTeX commands.
`;

      const result = await model.generateContent([prompt]);
      const response = await result.response;
      const text = response.text();
      
      // Robust JSON extraction
      const jsonContent = extractJsonFromText(text);
      if (!jsonContent) {
        console.log(`No valid JSON found for PYQ solutions`);
        return [];
      }

      try {
        const solutions = JSON.parse(jsonContent) as ExtractedQuestion[];
        return solutions;
      } catch (parseError) {
        console.error(`JSON parsing error for PYQ solutions:`, parseError);
        return [];
      }

    } catch (error: any) {
      retryCount++;
      console.error(`Error with API key ${retryCount} for PYQ solutions:`, error);
      
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit for PYQ solutions, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      if (retryCount >= maxRetries) {
        throw new Error(`All ${maxRetries} API keys exhausted for PYQ solutions: ${error.message}`);
      }
    }
  }
  
  throw new Error(`Failed to generate PYQ solutions after trying all API keys`);
}

// Robust JSON extraction helper function
function extractJsonFromText(text: string): string | null {
  // First try to find JSON in code blocks
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // Find the first occurrence of [ or {
  let startIndex = -1;
  let startChar = '';
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[' || text[i] === '{') {
      startIndex = i;
      startChar = text[i];
      break;
    }
  }
  
  if (startIndex === -1) {
    return null;
  }
  
  // Find the matching closing bracket/brace
  const endChar = startChar === '[' ? ']' : '}';
  let endIndex = -1;
  
  for (let i = text.length - 1; i >= startIndex; i--) {
    if (text[i] === endChar) {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex === -1) {
    return null;
  }
  
  return text.substring(startIndex, endIndex + 1);
}