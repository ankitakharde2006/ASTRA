// Reviewer Sub-agent for Course Recap
// Checks the generated recap against slides for accuracy and completeness

const { BaseAgent } = require('./base-agent');

class ReviewerAgent extends BaseAgent {
  constructor(model, tools) {
    super(model, tools, {
      name: 'reviewer',
      description: 'Reviews generated course recaps against slides to check for missed concepts, misrepresented content, and unsupported diagram edges',
      systemPrompt: `You are a reviewer agent that checks generated course recaps against the original slides. Your task is to evaluate the quality and accuracy of recaps. You should check:

1. MISSED KEY CONCEPTS: Are important concepts from the slides missing from the recap?
2. MISREPRESENTED/INVENTED CONTENT: Is any content in the recap not supported by the slides?
3. UNSUPPORTED DIAGRAM EDGES: Do any edges in the Mermaid flowchart not match relationships stated in the slides?

You must respond with either "APPROVED" if the recap passes all checks, or "FIX NEEDED" with bullet-point details of what needs to be corrected. Be thorough but concise. Focus only on factual accuracy against the slides.`
    });
  }

  async review(recapData, slidesData) {
    // Implementation for reviewing recap against slides
    // This would check the three criteria mentioned in the system prompt
    
    const result = await this.run({
      userMessage: `Please review this course recap against the slides:
      
      Recap Data: ${JSON.stringify(recapData, null, 2)}
      
      Slides Data: ${JSON.stringify(slidesData, null, 2)}
      
      Check for: 1) Missed key concepts, 2) Misrepresented/invented content, 3) Unsupported diagram edges.
      
      Respond with APPROVED or FIX NEEDED with bullet points if issues found.`
    });
    
    return result;
  }
}

module.exports = ReviewerAgent;