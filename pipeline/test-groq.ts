import { Groq } from 'groq-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testGroq() {
  console.log('Testing Groq API Connection...');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  
  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: 'Reply with OK' }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
    });
    console.log(`Response: ${response.choices[0]?.message?.content}`);
    if (response.choices[0]?.message?.content?.includes('OK')) {
      console.log('✅ Groq API connection successful.');
    } else {
      console.log('⚠️ Received unexpected response.');
    }
  } catch (err: any) {
    console.error('❌ Groq API connection failed:', err.message);
  }
}

testGroq();
