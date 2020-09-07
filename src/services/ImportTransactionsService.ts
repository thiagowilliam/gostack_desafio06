import { getCustomRepository, getRepository } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';

import AppError from '../errors/AppError';
import Category from '../models/Category';
import Transaction from '../models/Transaction';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface TransactionCSV {
  title: string;
  value: number;
  type: 'income' | 'outcome';
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const categoriesRepository = getRepository(Category);
    const transactionsRepository = getCustomRepository(TransactionsRepository);

    const transactionsCSV: TransactionCSV[] = [];
    const createdTransactions: Transaction[] = [];
    const dataReadStream = fs.createReadStream(filePath);
    const parserConfig = csvParse({
      from_line: 2,
    });
    const parseCSV = dataReadStream.pipe(parserConfig);

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) {
        throw new AppError('Invalid format file');
      }

      transactionsCSV.push({
        title,
        value,
        type,
        category,
      });
    });

    await new Promise(resolve => parseCSV.on('end', resolve));

    const categoriesCSV = transactionsCSV.map(
      transactionCSV => transactionCSV.category,
    );
    const uniqueCategories = categoriesCSV.filter(
      (value, index) => categoriesCSV.indexOf(value) === index,
    );
    const createdCategories = categoriesRepository.create(
      uniqueCategories.map(title => ({
        title,
      })),
    );
    await categoriesRepository.save(createdCategories);

    const promisesTransactions = transactionsCSV.map(async transactionCSV => {
      const transactionCategory = await categoriesRepository.findOne({
        where: { title: transactionCSV.category },
      });

      const transaction = transactionsRepository.create({
        title: transactionCSV.title,
        value: transactionCSV.value,
        type: transactionCSV.type,
        category: transactionCategory,
      });

      await transactionsRepository.save(transaction);

      delete transaction.category_id;
      createdTransactions.push(transaction);
    });

    await promisesTransactions.reduce(async (previousPromise, nextPromise) => {
      await previousPromise;
      await nextPromise;
    }, Promise.resolve());

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
