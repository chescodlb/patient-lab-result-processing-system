import Joi from 'joi';

export const labResultSchema = Joi.object({
  patientId: Joi.string().required().min(1).max(50),
  labType: Joi.string().valid('blood', 'urine', 'tissue', 'other').required(),
  result: Joi.string().required().min(1).max(1000),
  receivedAt: Joi.string().isoDate().required(),
});

export const validateLabResult = (data: any) => {
  return labResultSchema.validate(data);
};