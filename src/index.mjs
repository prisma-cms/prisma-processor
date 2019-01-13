

import moment from "moment";

import chalk from "chalk";


import jwt from "jsonwebtoken";



class AuthError extends Error {
  constructor() {
    super('Not authorized')
  }
}

export const getUserId = async function (ctx, token) {

  const Authorization = token || (ctx.request && ctx.request.get('Authorization'))

  if (Authorization) {
    const token = Authorization.replace('Bearer ', '')
    const { userId } = jwt.verify(token, process.env.APP_SECRET)

    const userExists = await ctx.db.exists.User({
      id: userId,
    });

    if (!userExists) {
      throw new AuthError()
    }

    return userId
  }

  throw new AuthError()
}


class PrismaProcessor {

  constructor(ctx) {

    if (!ctx) {
      throw (new Error("ctx required"));
    }

    Object.assign(this, {
      // source, 
      // args, 
      ctx,
      // info,
      // Type,
      message: "",
      errors: [],

      // Если приватный, будет выполнять проверки при обновлении объекта
      private: false,
    });

  }

  // message = {}
  // errors = [];
  // data;
  // success;


  fatal(message) {
    return this.log(message, "Fatal");
  }

  error(message) {

    // if (message instanceof Error || typeof message !== "object") {
    //   message = {
    //     message,
    //   };
    // }

    return this.log(message, "Error");
  }

  async log(options, level = "Info") {


    if (typeof options === "string") {
      options = {
        message: options,
        level,
      };
    }
    else if (options instanceof Error) {
      options = {
        message: options,
        level,
      };
    }
    else if (typeof options !== "object" || options.message === undefined) {
      try {
        options = {
          message: JSON.stringify(options),
        };
      }
      catch (error) {
        options = {
          message: error,
        };
      }
    }

    let {
      message,
      objectType,
      stack,
    } = options;

    if (message === undefined) {
      // throw (new Error("Message is undefined"));
      return this.log(new Error("Message is undefined"), "Error");
    }


    if (message instanceof Error) {
      stack = message.stack;
      message = message.message;
    }

    objectType = objectType !== undefined ? objectType : this.objectType;

    let error;

    await this.createLog({
      data: {
        message,
        objectType,
        level,
        stack,
      },
    });

    if (level === "Fatal") {
      throw (error);
    }

  }


  async createLog(args) {

    if (!args.data) {
      return this.log(new Error("args.data is empty"), "Error");
    }

    await this.ctx.db.mutation.createLog(args);
  }


  async getUser(required, token, sudo) {

    let {
      currentUser,
    } = this.ctx;


    if (!currentUser && token) {

      const userId = await getUserId(this.ctx, token)
        .catch(error => {
          console.error(error);
        });

      if (userId) {
        currentUser = await this.query("user", {
          where: {
            id: userId,
          },
        });

        if (!currentUser) {
          currentUser = await this.query("user", {
            where: {
              secondID: userId,
            },
          });
        }
      }

    }

    if (!currentUser && required) {
      throw (new Error("Не авторизован"));
    }

    if (sudo && (!currentUser || currentUser.sudo !== true)) {
      throw (new Error("Доступ запрещен"));
    }

    return currentUser;
  }



  hasErrors() {

    return this.success !== undefined || this.errors.length;
  }


  addError(message) {

    if (!message) {

    }
    else if (message instanceof Error) {
      message = message.message;
    }
    else if (Array.isArray(message) && message.findIndex(n => n.message) !== -1) {
      message = message.map(n => n.message).filter(n => n).join("; ");
    }
    else if (typeof message !== "string") {
      try {
        message = JSON.stringify(message);
      }
      catch (error) {
        message = error.message;
      }
    }


    this.message = message;
    this.success = false;
  }


  addFieldError(key, message) {
    this.errors.push({
      key,
      message,
    });
  }


  async mutate(method, args, info) {

    const {
      db,
    } = this.ctx;

    await this.checkPermission(method, args, info);

    if (!this.hasErrors()) {
      const result = await db.mutation[method](args, info)
        .catch(error => {
          this.addError(error);
          this.error(error);
          throw (error);
        });

      return result;
    }

  }


  async checkPermission(method, args, info) {

    /**
     * Если это приватный объект, то редактировать его могут только владельцы или судо
     */
    if (this.private) {

      const {
        where,
      } = args;

      if (where) {

        const {
          currentUser,
        } = this.ctx;

        if (!currentUser) {
          return this.addError("Пожалуйста, авторизуйтесь");
        }

        const {
          id: currentUserId,
          sudo,
        } = currentUser;


        if (sudo !== true) {

          let objectType = method.replace(/^(create|update|delete)(.{1})(.*)/, (match, p1, p2, p3) => `${p2.toLowerCase()}${p3}`);

          let object = await this.getObjectQuery(objectType, where, `{
            id
            CreatedBy{
              id
            }
          }`);

          if (!object) {
            return this.addError("Не был получен объект");
          }
          else if (!object.CreatedBy || object.CreatedBy.id !== currentUserId) {
            return this.addError("Нельзя редактировать чужой объект");
          }

        }

      }

    }

    return true;
  }


  async getObjectQuery(objectType, where, info) {

    return this.query(objectType, {
      where,
    }, info);

  }


  async create(objectType, args, info) {

    return await this.mutate(`create${objectType}`, args, info)
      .catch(error => {

        console.error(chalk.red(`create ${objectType} error`), error);

        this.addError(error);

        this.error({
          message: error,
          objectType,
        });

        throw (error);
      })
      ;

    // return this.prepareResponse();

  }


  async createWithResponse(objectType, args, info) {

    await this.create(objectType, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {

        console.error(chalk.red(`createWithResponse ${objectType} error`), error);

        this.addError(error);

        this.error(error);
        // throw (error); 

      })
      ;

    return this.prepareResponse();

  }



  async update(objectType, args, info) {

    return await this.mutate(`update${objectType}`, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {
        this.error({
          message: error,
          objectType,
        });
        this.addError(error);
        throw (error);
      })
      ;

    // return this.prepareResponse();

  }

  async update(objectType, args, info) {

    return await this.mutate(`update${objectType}`, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {
        this.error({
          message: error,
          objectType,
        });
        this.addError(error);
        throw (error);
      })
      ;

    // return this.prepareResponse();

  }




  async delete(objectType, args, info) {

    const result = await this.mutate(`delete${objectType}`, args, info)
      ;

    if (!result) {
      throw new Error(this.message || "Ошибка выполнения запроса");
    }

    return result;
  }


  async updateWithResponse(objectType, args, info) {

    await this.update(objectType, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {
        this.addError(error);
        this.error(error);
        console.error(error);

        // throw (error);
      })
      ;

    return this.prepareResponse();

  }


  async query(method, args, info) {

    const result = await this.ctx.db.query[method](args, info)
      .catch(error => {
        this.addError(error);

        throw (error);
      });

    return result;

  }

  prepareResponse() {

    const response = {
      success: !this.hasErrors() && this.data ? true : false,
      message: this.message,
      errors: this.errors,
      data: this.data,
    }


    return response;

  }



  DateTimeToDate(date) {
    /**
     * Важно делать именно так, чтобы проходил учет часового пояса
     */
    return date ? moment(date).utcOffset(date).format("YYYY-MM-DD HH:mm:ss.000") : undefined;
  }

}

export default PrismaProcessor;