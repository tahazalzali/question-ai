export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AI Question App API',
    version: '1.0.0',
    description: 'API docs for AI Question App',
  },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string' } } },
              },
            },
          },
        },
      },
    },

    // AI flow
    '/api/ai/session': {
      post: {
        summary: 'Start a new session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    question: { $ref: '#/components/schemas/QuestionOrFinal' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/ai/next': {
      post: {
        summary: 'Answer current question and get next',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                  sessionId: { type: 'string' },
                  answer: {
                    type: 'object',
                    properties: {
                      questionId: { type: 'string' },
                      selected: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Next question or final result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/QuestionOrFinal' },
              },
            },
          },
        },
      },
    },
    '/api/ai/session/{id}': {
      get: {
        summary: 'Get session by id',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Session',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Session' },
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },

    // Gemini
    '/api/gemini/models': {
      get: {
        summary: 'List grounding-capable models',
        responses: {
          200: {
            description: 'Models',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    models: { type: 'array', items: { type: 'string' } },
                    defaultModel: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/gemini/generate': {
      post: {
        summary: 'Generate with googleSearch tool',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                  prompt: { type: 'string' },
                  model: { type: 'string' },
                  temperature: { type: 'number' },
                  maxOutputTokens: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Grounded response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GroundedResponse' },
              },
            },
          },
        },
      },
    },
    '/api/gemini/legacy': {
      post: {
        summary: 'Legacy google_search_retrieval (1.5)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                  prompt: { type: 'string' },
                  model: { type: 'string' },
                  dynamicThreshold: { type: 'number' },
                  temperature: { type: 'number' },
                  maxOutputTokens: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Legacy response',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/GroundedResponse' },
                    {
                      type: 'object',
                      properties: { answeredFromModelKnowledge: { type: 'boolean' } },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },

  },
  components: {
    schemas: {
      QuestionOption: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'string' },
        },
      },
      Question: {
        type: 'object',
        properties: {
          questionId: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'] },
          title: { type: 'string' },
          type: { type: 'string', enum: ['single_select'] },
          options: { type: 'array', items: { $ref: '#/components/schemas/QuestionOption' } },
          hasNoneOfThese: { type: 'boolean' },
          selectedOptionId: { type: 'string', nullable: true },
          context: { type: 'object', properties: { sessionId: { type: 'string' } } },
          nextOnSelect: { type: 'string', enum: ['q2', 'q3', 'q4', 'done'] },
        },
      },
      FinalResults: {
        type: 'object',
        properties: {
          questionId: { type: 'string', enum: ['done'] },
          cacheUsed: { type: 'boolean' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                personId: { type: 'string' },
                fullName: { type: 'string' },
                firstName: { type: 'string', nullable: true },
                middleName: { type: 'string', nullable: true },
                lastName: { type: 'string', nullable: true },
                profession: { type: 'string', nullable: true },
                location: { type: 'string', nullable: true },
                employer: { type: 'string', nullable: true },
                education: { type: 'array', items: { type: 'string' } },
                emails: { type: 'array', items: { type: 'string' } },
                phones: { type: 'array', items: { type: 'string' } },
                social: { type: 'object', additionalProperties: true },
                age: { type: 'number', nullable: true },
                gender: { type: 'string', nullable: true },
                relatedPeople: { type: 'array', items: { type: 'object', additionalProperties: true } },
                confidence: { type: 'number' },
              },
            },
          },
        },
      },
      QuestionOrFinal: {
        oneOf: [{ $ref: '#/components/schemas/Question' }, { $ref: '#/components/schemas/FinalResults' }],
      },
      Session: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          query: { type: 'string' },
          candidates: { type: 'array', items: { type: 'string' } },
          answers: {
            type: 'object',
            properties: {
              profession: { type: 'string', nullable: true },
              location: { type: 'string', nullable: true },
              employer: { type: 'string', nullable: true },
              education: { type: 'string', nullable: true },
            },
          },
          flowState: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4', 'done'] },
          cacheKey: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      GroundedResponse: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          text: { type: 'string' },
          textWithCitations: { type: 'string' },
          groundingMetadata: { type: 'object', nullable: true, additionalProperties: true },
          raw: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const;